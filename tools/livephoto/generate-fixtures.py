"""Generate non-private rotation fixtures. Requires Pillow and ffmpeg on PATH."""
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
out = root / 'apps/mobile/app/src/androidTest/assets/livephoto'
out.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (320, 180))
draw = ImageDraw.Draw(image)
for box, color in [((0, 0, 159, 89), (240, 30, 30)),
                   ((160, 0, 319, 89), (30, 240, 30)),
                   ((0, 90, 159, 179), (30, 30, 240)),
                   ((160, 90, 319, 179), (240, 240, 30))]:
    draw.rectangle(box, fill=color)
image.save(out / 'corners.jpg', quality=100, subsampling=0)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                '-loop', '1', '-i', str(out / 'corners.jpg'),
                '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
                '-t', '1', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart',
                str(out / 'corners-audio.mp4')], check=True)
print(out)