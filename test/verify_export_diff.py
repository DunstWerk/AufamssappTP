#!/usr/bin/env python3
"""Verifiziert eine exportierte X31 gegen die Original-X31.

Zwei Modi:

  Nur Patches (bestehende Row-Werte geändert):
    python3 verify_export_diff.py <original.X31> <exported.X31> <changed_id1,...>

  Patches + neu eingefügte Positionen:
    python3 verify_export_diff.py <original.X31> <exported.X31> <changed_id1,...> --inserted <inserted_id1,...>

Prüfungen (unabhängig von gaebX31.js re-implementiert, als echte Gegenprobe):
  1. Byte-Ebene: außerhalb der Row="..."-Wertespannen der `changed`-IDs und außerhalb
     der neu eingefügten Teilbäume der `inserted`-IDs muss der Text exakt identisch
     sein — nichts vom Original wird beim Einfügen verschoben/verändert/gelöscht.
  2. Semantische Ebene: für `changed`-IDs ändert sich NUR das QTakeoff/Row-Attribut.
     Für `inserted`-IDs muss ein neues <Item ID="..."> mit <QTakeoff Row="..."> im
     Export auftauchen, das im Original nicht existierte; alle sonstigen Elemente
     aus dem Original müssen unverändert im Export wiederzufinden sein.

Exit-Code 0 = OK, 1 = Abweichung gefunden.
"""
import re
import sys
import xml.etree.ElementTree as ET


def find_item_row_spans(text, expected_ids):
    """Liefert {id: (start, end)} der Row-Attributwert-Spannen für die
    gegebenen IDs, per Regex direkt auf dem Rohtext."""
    spans = {}
    for item_id in expected_ids:
        item_re = re.compile(r'<Item ID="' + re.escape(item_id) + r'"')
        m = item_re.search(text)
        if not m:
            raise AssertionError(f"ID {item_id} nicht im Text gefunden")
        start = m.start()
        boundary_re = re.compile(r'<Item ID="|</Itemlist>')
        b = boundary_re.search(text, m.end())
        end = b.start() if b else len(text)
        chunk = text[start:end]
        qtakeoffs = list(re.finditer(r'<QTakeoff\b[^>]*\bRow="([^"]*)"[^>]*/?>', chunk))
        if not qtakeoffs:
            raise AssertionError(f"Kein QTakeoff in Position {item_id} gefunden")
        last = qtakeoffs[-1]
        row_start_in_chunk = last.start(1)
        row_end_in_chunk = last.end(1)
        spans[item_id] = (start + row_start_in_chunk, start + row_end_in_chunk)
    return spans


def find_matching_close(text, tag_name, open_tag_start):
    """Eigenständige Python-Re-Implementierung des balanced-tag-scans aus
    gaebX31.js (bewusst unabhängig gehalten, als echte Gegenprobe)."""
    open_needle = f'<{tag_name}'
    assert text[open_tag_start:open_tag_start + len(open_needle)] == open_needle
    close_needle = f'</{tag_name}>'
    first_tag_end = text.index('>', open_tag_start)
    depth = 1
    pos = first_tag_end + 1
    while depth > 0:
        next_open = text.find(open_needle, pos)
        next_close = text.find(close_needle, pos)
        if next_close == -1:
            raise AssertionError(f"Kein schließendes </{tag_name}> gefunden")
        if next_open != -1 and next_open < next_close:
            after_char = text[next_open + len(open_needle):next_open + len(open_needle) + 1]
            if after_char in (' ', '>', '\t', '\n'):
                depth += 1
            pos = next_open + len(open_needle)
            continue
        depth -= 1
        if depth == 0:
            return next_close
        pos = next_close + len(close_needle)


def find_inserted_span(exported_text, orig_root, exported_root, inserted_id):
    """Bestimmt den vollen Rohtext-Span (Start des öffnenden bis Ende des
    schließenden Tags) des NEU eingefügten Teilbaums für `inserted_id`: läuft im
    exportierten Baum von <Item ID=inserted_id> nach oben, bis eine ID gefunden
    wird, die auch im Original existiert (oder der BoQ-Wurzel) — der zuletzt
    besuchte, im Original NICHT vorhandene Knoten ist die Wurzel des neuen
    Teilbaums."""
    orig_ids = {el.get('ID') for el in orig_root.iter() if el.get('ID') is not None}

    exported_item = None
    for el in exported_root.iter():
        if strip_ns(el.tag) == 'Item' and el.get('ID') == inserted_id:
            exported_item = el
            break
    if exported_item is None:
        raise AssertionError(f"Neu eingefügte ID {inserted_id} nicht als <Item> im Export gefunden.")
    if inserted_id in orig_ids:
        raise AssertionError(f"ID {inserted_id} sollte neu sein, existierte aber schon im Original.")

    # Elternkette bestimmen (ElementTree kennt keine Parent-Referenzen -> Baum
    # einmal indizieren).
    parent_map = {child: parent for parent in exported_root.iter() for child in parent}

    newest_root_el = exported_item
    newest_root_tag = 'Item'
    node = exported_item
    while node in parent_map:
        parent = parent_map[node]
        if strip_ns(parent.tag) == 'BoQCtgy':
            if parent.get('ID') in orig_ids:
                break
            newest_root_el = parent
            newest_root_tag = 'BoQCtgy'
        node = parent

    if newest_root_tag == 'BoQCtgy':
        cat_id = newest_root_el.get('ID')
        open_idx = exported_text.index(f'<BoQCtgy ID="{cat_id}"')
        close_idx = find_matching_close(exported_text, 'BoQCtgy', open_idx)
        return open_idx, close_idx + len('</BoQCtgy>')

    # Kein neuer Vorfahre -> nur das <Item> selbst (ggf. inkl. neu geschaffener
    # <Itemlist>, falls die Itemlist nur dieses eine neue Item enthält und im
    # Original an dieser Stelle noch keine Itemlist stand).
    item_open_idx = exported_text.index(f'<Item ID="{inserted_id}"')
    item_close_idx = exported_text.index('</Item>', item_open_idx) + len('</Item>')
    before = exported_text[:item_open_idx]
    after = exported_text[item_close_idx:]
    if before.rstrip().endswith('<Itemlist>') and after.lstrip().startswith('</Itemlist>'):
        itemlist_open = before.rindex('<Itemlist>')
        itemlist_close = after.index('</Itemlist>') + item_close_idx + len('</Itemlist>')
        # Nur übernehmen, wenn diese Itemlist tatsächlich neu ist (nicht schon im
        # Original an vergleichbarer Stelle existierte) -> heuristisch: wenn der
        # unmittelbare Elterncontainer (BoQBody) keine Itemlist im Original hatte,
        # ist das Wrapping neu. Wir prüfen konservativ nur, ob exakt EIN Item drin
        # steht (die Erzeugungslogik fügt Itemlist nur in genau diesem Fall neu ein).
        inner = exported_text[itemlist_open:itemlist_close]
        if inner.count('<Item ') == 1:
            return itemlist_open, itemlist_close
    return item_open_idx, item_close_idx


def strip_ns(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag


def remove_spans(text, spans):
    """Entfernt eine Liste (start, end)-Spannen aus text, von hinten nach vorne
    (damit vorher berechnete Offsets gültig bleiben). Spannen dürfen sich nicht
    überlappen."""
    result = text
    for start, end in sorted(spans, reverse=True):
        result = result[:start] + result[end:]
    return result


def merge_overlapping(spans):
    """Fasst identische/ineinander verschachtelte Spannen zusammen (z.B. wenn
    mehrere IDs denselben neu eingefügten Teilbaum teilen)."""
    merged = []
    for start, end in sorted(spans):
        if merged and start < merged[-1][1]:
            prev_start, prev_end = merged[-1]
            merged[-1] = (prev_start, max(prev_end, end))
        else:
            merged.append((start, end))
    return merged


def byte_level_check(orig_text, exported_text, changed_ids, inserted_ids, orig_root, exported_root):
    """Prüft, dass außerhalb der markierten Änderungen (Patches + Inserts)
    ALLES andere byte-identisch ist — unabhängig davon, ob eine gepatchte
    Row-Zeichenkette im Export länger/kürzer ist als im Original (das REB-
    Zeilenformat ist nicht fest breitengebunden, siehe gaebX31.js). Strategie:
    alle markierten Spannen aus BEIDEN Texten herausschneiden (je auf ihrer
    eigenen Seite lokalisiert) und die beiden Reste auf exakte Gleichheit
    prüfen — das ist robuster als eine Cursor-Wanderung mit Längenannahmen."""
    if len(orig_text) == 0 or len(exported_text) == 0:
        raise AssertionError("Leere Datei übergeben")

    orig_changed_spans = list(find_item_row_spans(orig_text, changed_ids).values()) if changed_ids else []
    exp_changed_spans = list(find_item_row_spans(exported_text, changed_ids).values()) if changed_ids else []

    exp_inserted_spans = merge_overlapping(
        {find_inserted_span(exported_text, orig_root, exported_root, iid) for iid in inserted_ids}
    ) if inserted_ids else []

    orig_reduced = remove_spans(orig_text, orig_changed_spans)
    exp_reduced = remove_spans(exported_text, exp_changed_spans + exp_inserted_spans)

    if orig_reduced != exp_reduced:
        for i, (a, b) in enumerate(zip(orig_reduced, exp_reduced)):
            if a != b:
                raise AssertionError(
                    f"Unerwartete Abweichung außerhalb der markierten Änderungen bei Position {i}: "
                    f"{orig_reduced[max(0, i - 20):i + 20]!r} vs {exp_reduced[max(0, i - 20):i + 20]!r}"
                )
        raise AssertionError(
            f"Unerwartete Längenabweichung außerhalb der markierten Änderungen "
            f"(Original {len(orig_reduced)} Zeichen, Export {len(exp_reduced)} Zeichen)"
        )

    print(f"[byte-level] OK — {len(changed_ids)} Patch(es), {len(inserted_ids)} Insert(s) identifiziert, Rest byte-identisch.")


def collect_elements(el, path=''):
    out = []
    my_path = f'{path}/{strip_ns(el.tag)}'
    out.append((my_path, strip_ns(el.tag), el.attrib))
    child_counts = {}
    for child in el:
        child_counts[strip_ns(child.tag)] = child_counts.get(strip_ns(child.tag), 0) + 1
        idx = child_counts[strip_ns(child.tag)]
        out.extend(collect_elements(child, f'{my_path}[{strip_ns(child.tag)}#{idx}]'))
    return out


def semantic_check(orig_root, exported_root, changed_ids, inserted_ids):
    orig_elements = collect_elements(orig_root)
    exp_elements = collect_elements(exported_root)
    orig_map = {path: (tag, attrib) for path, tag, attrib in orig_elements}
    exp_map = {path: (tag, attrib) for path, tag, attrib in exp_elements}

    missing = [p for p in orig_map if p not in exp_map]
    if missing:
        raise AssertionError(f"Elemente aus dem Original fehlen im Export: {missing[:5]}")

    added_paths = [p for p in exp_map if p not in orig_map]
    if inserted_ids:
        exported_ids = {attrib.get('ID') for _, tag, attrib in exp_elements if tag == 'Item'}
        orig_ids = {attrib.get('ID') for _, tag, attrib in orig_elements if tag == 'Item'}
        for iid in inserted_ids:
            if iid in orig_ids:
                raise AssertionError(f"ID {iid} sollte laut Test neu eingefügt werden, existierte aber schon im Original.")
            if iid not in exported_ids:
                raise AssertionError(f"ID {iid} wurde nicht als neues <Item> im Export gefunden.")
    elif added_paths:
        raise AssertionError(f"Unerwartete neue Elemente ohne --inserted-Angabe: {added_paths[:5]}")

    diffs = []
    for path, (otag, oattrib) in orig_map.items():
        etag, eattrib = exp_map[path]
        if otag != etag:
            raise AssertionError(f"Struktur weicht ab bei {path}: {otag} vs {etag}")
        if set(oattrib.keys()) != set(eattrib.keys()):
            raise AssertionError(f"Attribut-Namen weichen ab bei {path}: {oattrib.keys()} vs {eattrib.keys()}")
        for k in oattrib:
            if oattrib[k] != eattrib[k]:
                diffs.append((path, otag, k, oattrib[k], eattrib[k]))

    unexpected = [d for d in diffs if not (d[1] == 'QTakeoff' and d[2] == 'Row')]
    if unexpected:
        raise AssertionError(f"Unerwartete Attributänderungen: {unexpected}")

    print(f"[semantic] OK — {len(diffs)} Attributänderung(en) (Patches), {len(added_paths)} neue(s) Element(e) (Inserts für {sorted(inserted_ids)}).")


def main():
    args = sys.argv[1:]
    inserted_ids = []
    if '--inserted' in args:
        idx = args.index('--inserted')
        inserted_ids = [x for x in args[idx + 1].split(',') if x]
        args = args[:idx] + args[idx + 2:]

    if len(args) != 3:
        print(__doc__)
        sys.exit(2)
    orig_path, exported_path, ids_csv = args
    changed_ids = [x for x in ids_csv.split(',') if x]

    with open(orig_path, encoding='utf-8') as f:
        orig_text = f.read()
    with open(exported_path, encoding='utf-8') as f:
        exported_text = f.read()

    try:
        orig_root = ET.fromstring(orig_text)
        exported_root = ET.fromstring(exported_text)
        byte_level_check(orig_text, exported_text, changed_ids, inserted_ids, orig_root, exported_root)
        semantic_check(orig_root, exported_root, changed_ids, inserted_ids)
    except AssertionError as e:
        print(f"FEHLER: {e}")
        sys.exit(1)

    print("Alle Prüfungen bestanden.")
    sys.exit(0)


if __name__ == '__main__':
    main()
