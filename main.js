const { core, console, event, mpv, menu, utils } = iina;

const SAMPLE_POINTS = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85];
const FRAMES_PER_SAMPLE = 10;
const MIN_KEPT_FRACTION = 0.5;
const MIN_TRIM_PX = 8;

const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]
  .find((bin) => utils.fileInPath(bin));

const setCrop = (value) => mpv.command("set", ["file-local-options/video-crop", value]);

const parseCrop = (stderr) => {
  const last = [...stderr.matchAll(/crop=(-?\d+):(-?\d+):(-?\d+):(-?\d+)/g)].at(-1);
  return last && { w: +last[1], h: +last[2], x: +last[3], y: +last[4] };
};

const sampleAt = (path, seconds) =>
  utils
    .exec(ffmpeg, [
      "-nostdin", "-hide_banner", "-nostats",
      "-ss", seconds.toFixed(2), "-i", path,
      "-map", "0:v:0", "-an", "-sn", "-dn",
      "-frames:v", String(FRAMES_PER_SAMPLE),
      "-vf", "cropdetect=limit=24/255:round=2:reset=0",
      "-f", "null", "-",
    ])
    .then(({ stderr }) => parseCrop(stderr))
    .catch(() => null);

const union = (boxes) =>
  boxes.reduce((a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
      x,
      y,
      w: Math.max(a.x + a.w, b.x + b.w) - x,
      h: Math.max(a.y + a.h, b.y + b.h) - y,
    };
  });

let generation = 0;

const showCropped = (cropped) => {
  cropItem.selected = cropped;
  menu.forceUpdate();
};

const clear = () => {
  generation++;
  setCrop("");
  showCropped(false);
};

const detect = async () => {
  const run = ++generation;

  const path = mpv.getString("path");
  const duration = mpv.getNumber("duration");
  if (!ffmpeg || !path || !(duration > 2)) return;

  const samples = await Promise.all(SAMPLE_POINTS.map((p) => sampleAt(path, duration * p)));
  if (run !== generation) return;

  const width = mpv.getNumber("width");
  const height = mpv.getNumber("height");
  const plausible = samples.filter(
    (b) => b && b.w >= width * MIN_KEPT_FRACTION && b.h >= height * MIN_KEPT_FRACTION,
  );
  const box = plausible.length > 0 && union(plausible);

  if (!box || width - box.w + (height - box.h) < MIN_TRIM_PX) {
    core.osd("No black bars found");
    return;
  }

  setCrop(`${box.w}x${box.h}+${box.x}+${box.y}`);
  showCropped(true);
  core.osd(`Cropped black bars (${box.w}×${box.h})`);
};

const toggle = () => (mpv.getString("video-crop") ? clear() : detect());

const cropItem = menu.item("Crop black bars", toggle, { keyBinding: "b" });

menu.addItem(cropItem);

event.on("iina.file-loaded", () => {
  generation++;
  showCropped(false);
});

if (!ffmpeg) console.warn("ffmpeg not found; auto-crop is inactive");
