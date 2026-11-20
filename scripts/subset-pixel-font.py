"""Build the GitDots subset from the Galmuri11 2.40.3 WOFF2 with fonttools[woff]."""

import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'src/assets/fonts/GitDotsPixel-Regular.woff2'
FAMILY = 'GitDots Pixel'
POSTSCRIPT = 'GitDotsPixel-Regular'


def label_characters():
    scenes = (ROOT / 'src/pixel/sceneDrawers.ts').read_text(encoding='utf-8')
    scenes = '\n'.join(line for line in scenes.splitlines() if not line.lstrip().startswith('//'))
    engine = (ROOT / 'src/engine/pixelEngine.ts').read_text(encoding='utf-8')
    speakers = engine.split('const SPEAKER_NAMES:', 1)[1].split('};', 1)[0]
    hangul = {ord(character) for character in scenes + speakers if '가' <= character <= '힣'}
    return set(range(32, 127)) | hangul | {ord(character) for character in '·…−→✓'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Original Galmuri11.woff2 from Galmuri 2.40.3')
    args = parser.parse_args()

    options = subset.Options()
    options.name_IDs = ['*']
    options.name_languages = ['*']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=label_characters())

    with TTFont(args.source, recalcTimestamp=False) as font:
        subsetter.subset(font)
        names = font['name']
        names.names = [record for record in names.names if record.nameID not in {1, 2, 3, 4, 6, 16, 17, 18, 20, 21, 22, 25}]
        for name_id, value in {1: FAMILY, 2: 'Regular', 3: f'{POSTSCRIPT};2.40.3', 4: FAMILY, 6: POSTSCRIPT}.items():
            names.setName(value, name_id, 3, 1, 0x409)
            names.setName(value, name_id, 0, 4, 0)
        font.flavor = 'woff2'
        font.save(OUTPUT)
        print(f'{OUTPUT.name}: {len(font.getBestCmap())} characters, {OUTPUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
