import subprocess, sys
import numpy as np
SR = 44100
DUR = 20.0
MOTOR = '/home/user/mt3uk/audio/motor-session.mp3'

def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

base = decode(MOTOR)
base /= np.max(np.abs(base))                       # full scale, then set the level below
N = int(DUR * SR)
X = int(0.25 * SR)                                  # crossfade at each loop seam
ramp = np.linspace(0, 1, X)
loop = base.copy()
loop[:X] *= ramp
loop[-X:] *= ramp[::-1]
motor = np.zeros(N)
step = len(loop) - X
pos = 0
while pos < N:
    end = min(N, pos + len(loop))
    motor[pos:end] += loop[:end - pos]
    pos += step
# Engine level: a gentle swell through the laps, a rise into the end card, fade in and out.
t = np.arange(N) / SR
swell = 0.8 + 0.2 * np.sin(2 * np.pi * t / 6.0)
fade = np.clip(t / 0.8, 0, 1) * np.clip((DUR - t) / 1.2, 0, 1)
motor *= 0.16 * swell * fade

mix = motor.copy()

def tone(freq, start, length, amp=0.5, decay=8.0):
    i0 = int(start * SR)
    n = int(length * SR)
    tt = np.arange(n) / SR
    env = np.exp(-decay * tt)
    seg = amp * env * np.sin(2 * np.pi * freq * tt)
    end = min(N, i0 + n)
    mix[i0:end] += seg[:end - i0]

def beep(start):                                    # the lap timer: a short two-tone beep when a lap is in
    tone(1760, start, 0.14, 0.28, 6)
    tone(2093, start + 0.14, 0.30, 0.3, 5)

def tick(start):
    tone(1400, start, 0.05, 0.25, 60)

def whoosh(start, length=0.45):
    i0 = int(start * SR); n = int(length * SR)
    rng = np.random.default_rng(int(start * 1000))
    noise = rng.standard_normal(n)
    noise = np.diff(noise, prepend=0)               # brighter
    env = np.sin(np.pi * np.arange(n) / n) ** 2
    end = min(N, i0 + n)
    mix[i0:end] += 0.05 * (noise / noise.std() * env)[:end - i0]

def chime(start):                                   # end card: three rising notes
    for k, f in enumerate([880, 1320, 1760]):
        tone(f, start + k * 0.12, 0.9, 0.22, 3.5)

# Lap completions (from the scenes): lap 1, lap 2, A and B finish in "Compared".
beep(6.2)
beep(9.4)
beep(13.04)
beep(13.1)
# Scene changes: a soft whoosh.
for s in [2.4, 6.4, 9.6, 13.4]:
    whoosh(s)
# Make chips pop in.
for s in [13.7, 13.82, 14.04, 14.26, 14.48]:
    tick(s)
whoosh(16.6, 0.6)
chime(16.9)
# Start of the reel: the timer starts.
tick(0.15)

mix = np.clip(mix * 1.8, -0.95, 0.95)
pcm = (mix * 32767).astype('<i2')
with open('audio.raw', 'wb') as f:
    f.write(pcm.tobytes())
print('samples', N, 'peak', float(np.max(np.abs(mix))))
