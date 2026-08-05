#!/usr/bin/env python3
"""Verifiziert eine exportierte X31 gegen die Original-X31.

Zwei unabhängige Prüfungen, beide müssen bestehen:
  1. Byte-Ebene: außerhalb der Row="..."-Wertespannen der erwarteten IDs muss
     der Text exakt identisch sein (eigene, von gaebX31.js unabhängige
     Anker-Suche direkt auf dem Rohtext).
  2. Semantische Ebene: identischer Element-Baum (keine hinzugefügten/entfernten
     Elemente), die einzigen abweichenden Attributwerte im ganzen Dokument sind
     die Row-Attribute von QTakeoff-Elementen der erwarteten IDs.

Aufruf:
    python3 verify_export_diff.py <original.X31> <exported.X31> <id1,id2,...>

Exit-Code 0 = OK, 1 = Abweichung gefunden.
"""
import re
import sys
import xml.etree.ElementTree as ET


def find_item_row_spans(text, expected_ids):
    """Liefert {id: (start, end)} der Row-Attributwert-Spannen für die
    gegebenen IDs, per Regex direkt auf dem Rohtext (unabhängig von
    gaebX31.js, als echte Gegenprobe)."""
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


def byte_level_check(orig_text, exported_text, expected_ids):
    if len(orig_text) == 0 or len(exported_text) == 0:
        raise AssertionError("Leere Datei übergeben")

    orig_spans = find_item_row_spans(orig_text, expected_ids)

    # Baue eine Liste von (start,end) Ausschluss-Bereichen im Original-Text,
    # sortiert, und prüfe stückweise Gleichheit außerhalb dieser Bereiche.
    excluded = sorted(orig_spans.values())
    cursor_orig = 0
    cursor_exp = 0
    for (ex_start, ex_end) in excluded:
        prefix_orig = orig_text[cursor_orig:ex_start]
        prefix_exp = exported_text[cursor_exp:cursor_exp + len(prefix_orig)]
        if prefix_orig != prefix_exp:
            raise AssertionError(
                f"Unerwartete Abweichung außerhalb der Row-Spannen bei Original-Offset {cursor_orig}"
            )
        # Der Wert selbst darf abweichen, muss aber dieselbe Länge haben
        # (chirurgisches Patching ersetzt nur den Attributwert, ändert nicht
        # die umgebende Struktur).
        orig_value_len = ex_end - ex_start
        cursor_exp += len(prefix_orig) + orig_value_len
        cursor_orig = ex_end

    tail_orig = orig_text[cursor_orig:]
    tail_exp = exported_text[cursor_exp:]
    if tail_orig != tail_exp:
        raise AssertionError("Unerwartete Abweichung nach der letzten Row-Spanne")

    print(f"[byte-level] OK — {len(expected_ids)} Row-Spanne(n) identifiziert, Rest byte-identisch.")


def strip_ns(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag


def collect_elements(el, path=''):
    """Liefert eine Liste (path, tag, sorted attrib items) für den ganzen Baum,
    in Dokumentreihenfolge, zur strukturellen (Element-für-Element) Prüfung."""
    out = []
    my_path = f'{path}/{strip_ns(el.tag)}'
    out.append((my_path, strip_ns(el.tag), el.attrib))
    child_counts = {}
    for child in el:
        child_counts[strip_ns(child.tag)] = child_counts.get(strip_ns(child.tag), 0) + 1
        idx = child_counts[strip_ns(child.tag)]
        out.extend(collect_elements(child, f'{my_path}[{strip_ns(child.tag)}#{idx}]'))
    return out


def semantic_check(orig_root, exported_root, expected_ids):
    orig_elements = collect_elements(orig_root)
    exp_elements = collect_elements(exported_root)

    if len(orig_elements) != len(exp_elements):
        raise AssertionError(
            f"Elementanzahl unterschiedlich: original={len(orig_elements)} export={len(exp_elements)} "
            "— es dürfen keine Elemente hinzugefügt/entfernt werden."
        )

    diffs = []
    for (op, otag, oattrib), (ep, etag, eattrib) in zip(orig_elements, exp_elements):
        if op != ep or otag != etag:
            raise AssertionError(f"Struktur weicht ab: {op} ({otag}) vs {ep} ({etag})")
        okeys = set(oattrib.keys())
        ekeys = set(eattrib.keys())
        if okeys != ekeys:
            raise AssertionError(f"Attribut-Namen weichen ab bei {op}: {okeys} vs {ekeys}")
        for k in okeys:
            if oattrib[k] != eattrib[k]:
                diffs.append((op, otag, k, oattrib[k], eattrib[k]))

    unexpected = [d for d in diffs if not (d[1] == 'QTakeoff' and d[2] == 'Row')]
    if unexpected:
        raise AssertionError(f"Unerwartete Attributänderungen: {unexpected}")

    changed_paths = {d[0] for d in diffs}
    if len(changed_paths) != len(expected_ids):
        print(f"[semantic] WARNUNG: {len(changed_paths)} geänderte QTakeoff-Row-Attribute gefunden, "
              f"erwartet wurden {len(expected_ids)} (IDs: {sorted(expected_ids)}).")

    print(f"[semantic] OK — {len(diffs)} Attributänderung(en), alle ausschließlich QTakeoff/Row.")


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    orig_path, exported_path, ids_csv = sys.argv[1:4]
    expected_ids = [x for x in ids_csv.split(',') if x]

    with open(orig_path, encoding='utf-8') as f:
        orig_text = f.read()
    with open(exported_path, encoding='utf-8') as f:
        exported_text = f.read()

    try:
        byte_level_check(orig_text, exported_text, expected_ids)
        orig_root = ET.fromstring(orig_text)
        exported_root = ET.fromstring(exported_text)
        semantic_check(orig_root, exported_root, expected_ids)
    except AssertionError as e:
        print(f"FEHLER: {e}")
        sys.exit(1)

    print("Alle Prüfungen bestanden.")
    sys.exit(0)


if __name__ == '__main__':
    main()
