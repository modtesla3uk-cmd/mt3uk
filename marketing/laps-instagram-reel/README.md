# Laps Instagram reel

A 25 second vertical reel (each slide holds for a second before it goes, so it can be read) (1080 x 1920) for Instagram, with the sound from the motor recording in `motor-reel-loop.mp3` (the first reel's loop) and synthesised lap beeps, whooshes and an end-card chime.

- `laps-instagram-reel.mp4`: the finished reel, H.264 video and AAC audio.
- `cover.jpg`: the end card, for the grid cover.
- `index.html`: the animation. `draw(t)` paints one frame at t seconds. The circuit is made up, so the speeds and gap are illustrative.
- `render.js`: renders the frames with Playwright (30fps, 750 frames), then encode them with ffmpeg.
- `audio.py`: builds the soundtrack (the motor loop plus the beeps) as `audio.raw`, to mux into the video.

Rebuild: run `node render.js` to make the frames, encode them with `ffmpeg -framerate 30 -i frames/f%04d.jpg -c:v libx264 -crf 17 -pix_fmt yuv420p silent.mp4`, run `python3 audio.py`, then mux the audio with `ffmpeg -i silent.mp4 -i audio.wav -c:v copy -c:a aac -shortest laps-instagram-reel.mp4`.
