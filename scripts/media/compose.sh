#!/usr/bin/env bash
# Builds docs/media/promo.mp4 (+ poster and GIF) from:
#   $1 phone recording (iOS simulator, mp4)
#   $2 dashboard recording (scripts/media/record-dashboard.mjs, webm, 1080×726)
#   $3 seconds between the dashboard start and the phone start
#   $4 where the clip starts in the phone recording (s)
# Needs the cards from scripts/media/cards.mjs in /tmp/shipstat-cards and the
# screenshots from scripts/media/capture.mjs in docs/media.
set -euo pipefail
PHONE=$1 DASH=$2 OFFSET=$3 START=${4:-1.0}
CARDS=/tmp/shipstat-cards
MEDIA=$(cd "$(dirname "$0")/../../docs/media" && pwd)
WORK=$(mktemp -d)
LEN=17
F="fps=30,format=yuv420p"
DASH_START=$(echo "$START + $OFFSET" | bc)
enc() { ffmpeg -y -loglevel error "$@"; }

enc -loop 1 -t 2.8 -i $CARDS/title.png -vf "$F" -c:v libx264 -crf 16 $WORK/1.mp4
enc -loop 1 -t $LEN -i $CARDS/split.png -ss $START -t $LEN -i "$PHONE" -ss $DASH_START -t $LEN -i "$DASH" -filter_complex \
  "[1:v]scale=-2:856:flags=lanczos,setpts=PTS-STARTPTS[ph];[2:v]setpts=PTS-STARTPTS[db];[0:v][ph]overlay=x=120+(462-overlay_w)/2:y=152[a];[a][db]overlay=x=720:y=140,$F" \
  -t $LEN -c:v libx264 -crf 16 $WORK/2.mp4
for pair in "release board" "abtest ab"; do
  set -- $pair
  enc -loop 1 -t 3.4 -i $CARDS/$1.png -loop 1 -t 3.4 -i $MEDIA/$2-light.png -filter_complex \
    "[1:v]scale=1680:-2:flags=lanczos,crop=1680:690:0:0[s];[0:v][s]overlay=x=120:y=330,$F" -c:v libx264 -crf 16 $WORK/$1.mp4
done
enc -loop 1 -t 3.8 -i $CARDS/end.png -vf "$F" -c:v libx264 -crf 16 $WORK/5.mp4

O1=2.4; O2=$(echo "$O1 + $LEN - 0.4" | bc); O3=$(echo "$O2 + 3.0" | bc); O4=$(echo "$O3 + 3.0" | bc)
enc -i $WORK/1.mp4 -i $WORK/2.mp4 -i $WORK/release.mp4 -i $WORK/abtest.mp4 -i $WORK/5.mp4 -filter_complex \
  "[0][1]xfade=transition=fade:duration=0.4:offset=$O1[a];[a][2]xfade=transition=fade:duration=0.4:offset=$O2[b];[b][3]xfade=transition=fade:duration=0.4:offset=$O3[c];[c][4]xfade=transition=fade:duration=0.4:offset=$O4,format=yuv420p" \
  -c:v libx264 -crf 21 -preset slow -movflags +faststart "$MEDIA/promo.mp4"

# Poster: a frame of the split scene. GIF: the split scene only, for README previews.
enc -ss 9 -i "$MEDIA/promo.mp4" -frames:v 1 -q:v 3 "$MEDIA/promo-poster.jpg"
enc -ss 2.8 -t 16 -i "$MEDIA/promo.mp4" -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" "$MEDIA/promo.gif"
rm -rf $WORK
ls -la "$MEDIA"/promo*
