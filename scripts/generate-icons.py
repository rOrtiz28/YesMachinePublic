#!/usr/bin/env python3
"""Render the desktop icons from the Android launcher vector (the pixel ym logo), without redrawing it.

The source is android/app/src/main/res/drawable/ic_launcher.xml: the app's mint square with the ym letters on it.
This script converts it to an SVG (assets/icon.svg) and renders the app icons from that: assets/icon.png (1024 by
1024, for Linux and the app's own windows and Dock), icon.icns (macOS) and icon.ico (Windows).

It also renders the tray icons the desktop app shows: the colored mark for Linux and Windows (tray.png and
tray@2x.png), and for the macOS menu bar a template image of the ym letters alone, black on transparent
(trayTemplate.png and trayTemplate@2x.png), which macOS tints for light and dark menu bars.

Run it by hand after changing the launcher vector: python3 scripts/generate-icons.py. With --tray, it renders only
the tray icons, from the assets/icon.svg already there.

Requires rsvg-convert (librsvg) and macOS iconutil. Uses only Python's standard
library. PNG-compressed ICO entries are supported by modern Windows.
"""

from pathlib import Path
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
# Android's XML namespace, as ElementTree spells it in attribute names.
ANDROID = "{http://schemas.android.com/apk/res/android}"
SOURCE = ROOT / "android/app/src/main/res/drawable/ic_launcher.xml"


def value(element, name, default=None):
    """The value of an element's android:<name> attribute, or default when it doesn't have one."""
    return element.get(ANDROID + name, default)


def main():
    """Convert the launcher vector to assets/icon.svg, then render every desktop and tray icon from it."""
    # --- The vector as an SVG ---
    vector = ET.parse(SOURCE).getroot()
    group = vector.find("group")
    if group is None or any(child.tag != "path" for child in group):
        raise ValueError("The launcher source must contain a single group of paths.")
    # Android transforms a group around its pivot: it scales, then rotates, then moves the result by translateX and
    # translateY. Written as one SVG transform, which applies its rightmost step first, that is: move the pivot to
    # the origin, scale, rotate, then move back to the pivot plus the translation.
    pivot_x = float(value(group, "pivotX", "0"))
    pivot_y = float(value(group, "pivotY", "0"))
    translate_x = pivot_x + float(value(group, "translateX", "0"))
    translate_y = pivot_y + float(value(group, "translateY", "0"))
    transform = (
        f"translate({translate_x:g} {translate_y:g}) "
        f"rotate({value(group, 'rotation', '0')}) "
        f"scale({value(group, 'scaleX', '1')} {value(group, 'scaleY', '1')}) "
        f"translate({-pivot_x:g} {-pivot_y:g})"
    )
    svg = ET.Element("svg", {
        "xmlns": "http://www.w3.org/2000/svg", "width": "1024", "height": "1024",
        "viewBox": f"0 0 {value(vector, 'viewportWidth')} {value(vector, 'viewportHeight')}",
    })
    ET.SubElement(svg, "title").text = "Yes Machine"
    ET.SubElement(svg, "desc").text = "The ym launcher mark, converted from the Android vector."
    shapes = ET.SubElement(svg, "g", {"transform": transform})
    for path in group:
        ET.SubElement(shapes, "path", {"fill": value(path, "fillColor"), "d": value(path, "pathData")})
    ASSETS.mkdir(exist_ok=True)
    svg_path = ASSETS / "icon.svg"
    ET.indent(svg, space="  ")
    ET.ElementTree(svg).write(svg_path, encoding="utf-8", xml_declaration=True)

    def render(size, destination):
        """Render icon.svg as a size-by-size PNG at destination."""
        subprocess.run(["rsvg-convert", "--width", str(size), "--height", str(size),
                        "--output", str(destination), str(svg_path)], check=True)

    # --- Linux and macOS ---
    render(1024, ASSETS / "icon.png")
    with tempfile.TemporaryDirectory(prefix="yes-machine-icons-") as temporary:
        temp = Path(temporary)
        # macOS: an .iconset folder with each size at 1x and 2x, which iconutil packs into icon.icns.
        iconset = temp / "YesMachine.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            render(size, iconset / f"icon_{size}x{size}.png")
            render(size * 2, iconset / f"icon_{size}x{size}@2x.png")
        subprocess.run(["iconutil", "--convert", "icns", "--output", str(ASSETS / "icon.icns"),
                        str(iconset)], check=True)

        # --- Windows ---
        # icon.ico holds PNG images. Its layout: a 6-byte header (reserved 0, type 1 for an icon, the number of
        # images), then a 16-byte directory entry per image (width, height, palette size, reserved, color planes,
        # bits per pixel, the PNG's length and its offset in the file), then the PNG data itself. A width or
        # height of 0 means 256 pixels, which doesn't fit in a byte.
        entries = []
        for size in (16, 24, 32, 48, 64, 128, 256):
            path = temp / f"windows-{size}.png"
            render(size, path)
            entries.append((size, path.read_bytes()))
        offset = 6 + 16 * len(entries)
        directory = []
        for size, data in entries:
            dimension = size if size < 256 else 0
            directory.append(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(data), offset))
            offset += len(data)
        (ASSETS / "icon.ico").write_bytes(struct.pack("<HHH", 0, 1, len(entries))
                                         + b"".join(directory) + b"".join(data for _, data in entries))
    render_tray(svg_path)
    print("Generated assets/icon.svg, icon.png, icon.icns, icon.ico and the tray icons from", SOURCE.relative_to(ROOT))


def render_tray(svg_path=ASSETS / "icon.svg"):
    """Render the tray icons from the SVG at svg_path: the colored mark, and the macOS menu bar template."""
    def render(source, width, height, destination):
        """Render the SVG at source as a width-by-height PNG at destination."""
        subprocess.run(["rsvg-convert", "--width", str(width), "--height", str(height),
                        "--output", str(destination), str(source)], check=True)

    # Linux and Windows show the colored mark as it is.
    render(svg_path, 32, 32, ASSETS / "tray.png")
    render(svg_path, 64, 64, ASSETS / "tray@2x.png")
    # The macOS template keeps only the letters: the paths whose color differs from the first path, the mint square.
    svg = ET.parse(svg_path).getroot()
    namespace = "{http://www.w3.org/2000/svg}"
    group = svg.find(namespace + "g")
    letters = [path for path in group if path.get("fill") != group[0].get("fill")]
    # The letters span 640 × 336 of the 1024 square around its center. A 4:3 box around the center (the viewBox
    # below, 672 × 504) keeps them about two thirds as tall as the 18-point-high menu bar icon.
    template = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg", "width": "48", "height": "36",
                                  "viewBox": "176 260 672 504"})
    shapes = ET.SubElement(template, "g", {"transform": group.get("transform")})
    for path in letters:
        ET.SubElement(shapes, "path", {"fill": "#000000", "d": path.get("d")})
    with tempfile.TemporaryDirectory(prefix="yes-machine-tray-") as temporary:
        source = Path(temporary) / "tray-template.svg"
        ET.ElementTree(template).write(source, encoding="utf-8", xml_declaration=True)
        render(source, 24, 18, ASSETS / "trayTemplate.png")
        render(source, 48, 36, ASSETS / "trayTemplate@2x.png")


if __name__ == "__main__":
    import sys
    render_tray() if sys.argv[1:] == ["--tray"] else main()
