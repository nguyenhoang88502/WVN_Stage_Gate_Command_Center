"""Fetch a chosen subset of Tabler Icons (MIT) and assemble one SVG sprite.

The app runs air-gapped, so nothing may be fetched at runtime — this builds a
single self-contained sprite file that ships inside the bundle. Only the icons
the app actually references are included, keeping it a few KB rather than the
30MB upstream repo.
"""
import re
import sys
import urllib.request

RAW = "https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/{}.svg"

# name-in-repo -> id used in the app as <use href="#i-<id>">
ICONS = [
    # --- sidebar navigation (one per workspace tab) ---
    "layout-dashboard",
    "checklist",
    "file-import",
    "rocket",
    "git-branch",
    "settings",
    # --- header / command bar chrome ---
    "refresh",
    "moon",
    "sun",
    "menu-2",
    "plug-connected",
    "plug-connected-x",
    # --- status + state ---
    "alert-triangle",
    "alert-circle",
    "info-circle",
    "circle-check",
    "circle-x",
    "clock",
    "lock",
    "shield-lock",
    # --- content actions (replacing emoji) ---
    "message-circle",
    "folder-open",
    "pencil",
    "star",
    "arrow-right",
    "check",
    "x",
    "upload",
    "download",
    "trash",
    "plus",
    "search",
    "filter",
    "external-link",
    "printer",
    "paperclip",
    "dots-vertical",
    "chevron-down",
    "chevron-right",
    # --- domain objects ---
    "file-text",
    "files",
    "user",
    "users",
    "calendar-event",
    "table",
    "chart-bar",
    "clipboard-check",
    "building-factory-2",
]

VIEWBOX_RE = re.compile(r'viewBox="([^"]+)"')


def fetch(name: str) -> str:
    url = RAW.format(name)
    with urllib.request.urlopen(url, timeout=30) as r:
        if r.status != 200:
            raise RuntimeError(f"{name}: HTTP {r.status}")
        return r.read().decode("utf-8")


def inner(svg: str) -> str:
    """Strip the <svg> wrapper and the leading comment block, keep the paths."""
    body = svg.split(">", 1)[1] if svg.lstrip().startswith("<!--") else svg
    body = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    m = re.search(r"<svg[^>]*>(.*)</svg>", body, flags=re.S)
    if not m:
        raise RuntimeError("no <svg> body found")
    guts = m.group(1)
    # Tabler ships a transparent sizing rect in some icons; harmless, keep as-is.
    return guts.strip()


def main() -> int:
    symbols = []
    failed = []
    for name in ICONS:
        try:
            svg = fetch(name)
            vb = VIEWBOX_RE.search(svg)
            viewbox = vb.group(1) if vb else "0 0 24 24"
            # Tabler carries fill/stroke on the root <svg>, which the sprite
            # drops when the wrapper is stripped. Without them the paths render
            # as solid black blobs instead of outlines, so they are restated on
            # the <symbol> — this keeps the sprite self-describing even if the
            # host page's .icon CSS never loads.
            symbols.append(
                f'<symbol id="i-{name}" viewBox="{viewbox}" fill="none" '
                'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
                f'stroke-linejoin="round">{inner(svg)}</symbol>'
            )
            print(f"  ok  {name}")
        except Exception as e:  # noqa: BLE001 - report and continue
            failed.append((name, str(e)))
            print(f"  FAIL {name}: {e}", file=sys.stderr)

    header = (
        "<!-- Tabler Icons (https://github.com/tabler/tabler-icons) - MIT License.\n"
        "     Subset vendored for offline/air-gapped use; only the icons this app\n"
        "     references are included. Regenerate with system/vendor/build_sprite.py.\n"
        "     Stroke colour follows currentColor; size via CSS on the <svg> host. -->\n"
    )
    sprite = (
        header
        + '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" '
        + 'aria-hidden="true" data-icon-sprite="tabler">\n'
        + "\n".join(symbols)
        + "\n</svg>\n"
    )
    out = sys.argv[1]
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(sprite)
    print(f"\nwrote {out}: {len(symbols)} symbols, {len(sprite)} bytes")
    if failed:
        print(f"{len(failed)} FAILED: {[n for n, _ in failed]}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
