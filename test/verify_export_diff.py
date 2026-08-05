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


def byte_level_check(orig_text, exported_text, changed_ids, inserted_ids, orig_root, exported_root):
    if len(orig_text) == 0 or len(exported_text) == 0:
        raise AssertionError("Leere Datei übergeben")

    excluded_orig = list(find_item_row_spans(orig_text, changed_ids).values()) if changed_ids else []

    # Für jede eingefügte ID: Span im EXPORT bestimmen und als "hier wurde beim
    # Original nichts entfernt, im Export aber etwas hinzugefügt" behandeln.
    inserted_spans_export = sorted(
        (find_inserted_span(exported_text, orig_root, exported_root, iid) for iid in inserted_ids),
        key=lambda s: s[0],
    ) if inserted_ids else []

    excluded_orig.sort()
    cursor_orig = 0
    cursor_exp = 0
    ex_iter = iter(excluded_orig)
    ins_iter = iter(inserted_spans_export)
    next_ex = next(ex_iter, None)
    next_ins = next(ins_iter, None)

    while next_ex is not None or next_ins is not None:
        # Whichever comes next in the EXPORTED text's cursor position: an insert
        # (pure addition, no original counterpart) or a patch (original span of
        # equal length, value may differ).
        # Insertions must be handled at their export-side position; patches at
        # their original-side position. We advance whichever is closer given the
        # current cursors, comparing patch-original-offset (translated by the
        # already-applied inserted length) against the next insert's export offset.
        if next_ins is not None and (next_ex is None or (cursor_orig + (next_ins[0] - cursor_exp)) <= next_ex[0]):
            ins_start, ins_end = next_ins
            prefix_len = ins_start - cursor_exp
            prefix_orig = orig_text[cursor_orig:cursor_orig + prefix_len]
            prefix_exp = exported_text[cursor_exp:cursor_exp + prefix_len]
            if prefix_orig != prefix_exp:
                raise AssertionError(f"Unerwartete Abweichung vor eingefügter Position (Original-Offset {cursor_orig})")
            cursor_orig += prefix_len
            cursor_exp = ins_end
            next_ins = next(ins_iter, None)
        else:
            ex_start, ex_end = next_ex
            prefix_len = ex_start - cursor_orig
            prefix_orig = orig_text[cursor_orig:cursor_orig + prefix_len]
            prefix_exp = exported_text[cursor_exp:cursor_exp + prefix_len]
            if prefix_orig != prefix_exp:
                raise AssertionError(f"Unerwartete Abweichung vor gepatchter Position (Original-Offset {cursor_orig})")
            cursor_orig += prefix_len
            cursor_exp += prefix_len
            value_len = ex_end - ex_start
            cursor_orig = ex_end
            cursor_exp += value_len
            next_ex = next(ex_iter, None)

    tail_orig = orig_text[cursor_orig:]
    tail_exp = exported_text[cursor_exp:]
    if tail_orig != tail_exp:
        raise AssertionError("Unerwartete Abweichung nach der letzten Änderung")

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
