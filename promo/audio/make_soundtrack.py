# 程序化合成配乐与音效（无第三方素材，可自由使用）。120 BPM，54 秒，与 video/timeline.js 的节点对齐。
import numpy as np
import wave

SR, DUR = 48000, 54.0
N = int(SR * DUR)
mix = np.zeros((N, 2))
rng = np.random.default_rng(7)


def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N or i < 0:
        return
    sig = sig[: N - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    mix[i : i + len(sig), 0] += sig * gain * l * 1.414
    mix[i : i + len(sig), 1] += sig * gain * r * 1.414


def tt(d):
    return np.arange(int(d * SR)) / SR


def _butter(x, fc, order, high):
    # 零相位巴特沃斯幅度响应（频域实现，只依赖 numpy）
    X = np.fft.rfft(x, axis=-1)
    f = np.fft.rfftfreq(x.shape[-1], 1 / SR)
    r = (f / fc) ** (2 * order)
    g = np.sqrt(r / (1 + r)) if high else 1 / np.sqrt(1 + r)
    return np.fft.irfft(X * g, x.shape[-1], axis=-1)


def lp(x, fc, order=2):
    return _butter(x, min(fc, SR * 0.45), order, False)


def hp(x, fc, order=2):
    return _butter(x, fc, order, True)


def hz(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def fade(x, a=0.004, r=0.02):
    na, nr = int(a * SR), int(r * SR)
    x = x.copy()
    x[:na] *= np.linspace(0, 1, na)
    x[-nr:] *= np.linspace(1, 0, nr)
    return x


def kick():
    t = tt(0.32)
    f = 46 + 110 * np.exp(-t * 34)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) + 0.25 * hp(rng.standard_normal(len(t)), 2000) * np.exp(-t * 300)


def hat(d=0.05):
    t = tt(d)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t / d * 5)


def clap():
    t = tt(0.22)
    n = lp(hp(rng.standard_normal(len(t)), 900), 5000)
    env = np.exp(-t * 26) + 0.6 * np.exp(-np.abs(t - 0.012) * 400) + 0.5 * np.exp(-np.abs(t - 0.024) * 400)
    return n * env


def pluck(n, d=0.42, bright=3200):
    t = tt(d)
    f = hz(n)
    s = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7)) + 0.4 * np.sin(2 * np.pi * f * 2.001 * t)
    return fade(lp(s, bright) * np.exp(-t * 9), 0.002, 0.03)


def bass(n, d=0.22):
    t = tt(d)
    f = hz(n)
    s = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * 2 * f * t) + 0.22 * np.sin(2 * np.pi * 3 * f * t)
    return fade(s * np.exp(-t * 5), 0.004, 0.03)


def pad(notes, d, bright=1800):
    t = tt(d)
    s = np.zeros(len(t))
    for n in notes:
        for det in (-0.07, 0.0, 0.08):
            f = hz(n + det)
            s += sum(np.sin(2 * np.pi * f * k * t + rng.uniform(0, 6.28)) / k for k in range(1, 6))
    env = np.minimum(1, t / 0.5) * np.minimum(1, (d - t) / 0.6)
    return lp(s, bright) * env / len(notes)


def swept_noise(d, kfn):
    # 一阶低通，系数随时间变化
    n = rng.standard_normal(int(d * SR))
    out = np.zeros(len(n))
    y = 0.0
    for i in range(len(n)):
        y += kfn(i / len(n)) * (n[i] - y)
        out[i] = y
    return out


def riser(d):
    t = tt(d)
    return hp(swept_noise(d, lambda x: 0.004 + 0.5 * x**3), 300) * (t / d) ** 2


def whoosh(d=0.55):
    t = tt(d)
    return hp(swept_noise(d, lambda x: 0.02 + 0.3 * np.sin(np.pi * x) ** 2), 400) * np.sin(np.pi * t / d) ** 2


def impact():
    t = tt(2.6)
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 9)) / SR) * np.exp(-t * 2.2)
    crash = lp(hp(rng.standard_normal(len(t)), 2500), 11000) * np.exp(-t * 2.6) * 0.5
    return boom + crash


def tick():
    t = tt(0.03)
    return np.sin(2 * np.pi * 2300 * t) * np.exp(-t * 220) + 0.5 * hp(rng.standard_normal(len(t)), 4000) * np.exp(-t * 500)


def pop(f0=520):
    t = tt(0.09)
    f = f0 * (1 + 0.8 * t / 0.09)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38)


# 和声：F 大调 I–V–vi–IV，每小节 2 秒，从 t=6 开始
CH = [([53, 57, 60, 64], 41), ([52, 55, 60, 64], 36), ([53, 57, 62, 65], 38), ([53, 58, 62, 65], 34)]
ARP = [0, 2, 1, 3, 2, 1, 3, 2]


def chord(t):
    return CH[int((t - 6) // 2) % 4]


def section(t):
    for end, name in ((6, "hook"), (10, "logo"), (18, "a"), (24, "b"), (33, "full"), (37, "break"), (42, "full"), (48, "peak")):
        if t < end:
            return name
    return "out"


# ── hook：紧张的脉冲 + 滴答 ──
for i in range(48):
    t = i * 0.125
    if i % 2 == 0:
        add(bass(38 if (i // 16) % 2 == 0 else 37, 0.2), t, 0.16 + 0.22 * t / 6)
    if i % 4 == 0:
        add(tick(), t, 0.10 + 0.05 * (i % 8 == 0), 0.3 if i % 8 else -0.3)
    if t >= 2 and i % 2 == 1:
        add(hat(0.03), t, 0.05 + 0.08 * (t - 2) / 4, 0.4)
add(pad([50, 53, 57], 6.0, 900), 0, 0.10)
for i in range(6):
    add(pop(380 + 40 * i), 2.2 + 0.33 * i, 0.28, -0.5 + 0.2 * i)
add(kick(), 4.3, 0.9)
add(impact(), 4.3, 0.22)
add(riser(2.3), 3.7, 0.55)
add(whoosh(0.45), 5.2, 0.5)

# ── 主体 ──
for step in range(int((48 - 6) / 0.25)):
    t = 6 + step * 0.25
    sec = section(t)
    notes, root = chord(t)
    if step % 8 == 0:
        g = {"logo": 0.16, "a": 0.11, "b": 0.11, "full": 0.12, "break": 0.15, "peak": 0.13}[sec]
        add(pad(notes, 2.25, 1500 if sec in ("logo", "break") else 2100), t, g)
    if sec == "logo":
        if step % 2 == 0:
            add(pluck(notes[ARP[step % 8]] + 24, 0.9, 2600), t, 0.13, 0.5 * np.sin(step))
        continue
    brk = sec == "break"
    if step % 2 == 0 and not brk:
        add(kick(), t, 0.85)
    if step % 2 == 1:
        add(hat(), t, 0.08 if brk else 0.16, 0.25)
    if sec in ("b", "full", "peak") and step % 4 == 2:
        add(clap(), t, 0.3)
    if sec in ("full", "peak"):
        add(hat(0.025), t + 0.125, 0.07, -0.3)
    bn = root + (12 if step % 8 in (3, 6) else 0)
    if brk:
        if step % 2 == 0:
            add(bass(bn, 0.4), t, 0.26)
    elif step % 2 == 1:
        add(bass(bn), t, 0.36)  # 反拍贝斯，让出底鼓
    else:
        add(bass(bn, 0.16), t + 0.125, 0.2)
    an = notes[ARP[step % 8]] + (24 if sec == "peak" else 12)
    g = {"a": 0.12, "b": 0.15, "full": 0.17, "break": 0.13, "peak": 0.16}[sec]
    add(pluck(an, 0.42, 2600 if sec == "a" else 3600), t, g, 0.6 * np.sin(step * 1.7))
    add(pluck(an, 0.42, 1800), t + 0.375, g * 0.35, -0.6 * np.sin(step * 1.7))  # 延迟回声
    if sec in ("full", "peak") and step % 8 == 0:
        add(pluck(notes[3] + 24, 1.2, 4200), t, 0.12, 0)

# ── 转场与重音 ──
add(impact(), 6.0, 0.75)
add(impact(), 30.0, 0.6)
add(impact(), 48.0, 0.8)
add(riser(1.6), 8.4, 0.3)
add(riser(2.0), 28.0, 0.5)
add(riser(2.0), 46.0, 0.55)
for tw in (10.0, 18.0, 21.2, 24.0, 33.0, 37.0, 39.4, 42.0, 44.0, 46.0):
    add(whoosh(), tw - 0.25, 0.42, rng.uniform(-0.4, 0.4))
for f in (47.0, 47.25, 47.5, 47.625, 47.75, 47.875):  # 过门
    add(clap(), f, 0.3)

# ── 界面音效（与光标点击、元素弹出对齐）──
for c in (16.2, 16.9, 18.7, 20.5, 24.85, 25.5, 26, 26.5, 27, 27.5, 28, 29.6, 37.9):
    add(tick(), c, 0.42)
for i, c in enumerate((25.5, 26, 26.5, 27, 27.5, 28)):
    add(pop(500 + 70 * i), c + 0.02, 0.3, 0.3)
for i, c in enumerate((19.0, 19.5, 20.0)):
    add(pop(640 + 80 * i), c, 0.26, 0.4)
for i in range(4):
    add(pop(560 + 60 * i), 13.3 + 0.5 * i, 0.2, 0.5)
    add(pop(600 + 50 * i), 39.5 + 0.14 * i, 0.22, -0.4 + 0.27 * i)
    add(pop(620 + 50 * i), 46.15 + 0.13 * i, 0.2, 0)
for i in range(6):
    add(pop(520 + 60 * i), 21.95 + 0.16 * i, 0.22, -0.4)
    add(pop(700 + 70 * i), 30.5 + 0.09 * i, 0.2, -0.5 + 0.2 * i)

# ── 尾声 ──
add(pad([53, 57, 60, 64, 67], 6.0, 2000), 48.0, 0.2)
add(bass(29, 2.5), 48.0, 0.4)
for i, n in enumerate([77, 72, 69, 65, 72, 69, 65, 60, 65]):
    add(pluck(n, 1.4, 3400), 48.5 + i * 0.5, 0.15, 0.5 * np.sin(i))
add(pop(880), 49.6, 0.25)

# ── 母带：简单混响、软削波、淡入淡出 ──
wet = np.zeros_like(mix)
for d, g in ((0.031, 0.32), (0.047, 0.26), (0.071, 0.2), (0.113, 0.15), (0.173, 0.1)):
    k = int(d * SR)
    wet[k:, 0] += mix[:-k, 1] * g
    wet[k:, 1] += mix[:-k, 0] * g
mix += lp(wet.T, 4500).T * 0.5
mix = np.tanh(mix * 0.85)
env = np.ones(N)
nf = int(1.6 * SR)
env[-nf:] = np.linspace(1, 0, nf) ** 1.5
env[: int(0.05 * SR)] = np.linspace(0, 1, int(0.05 * SR))
mix *= env[:, None]
mix *= 0.80 / np.abs(mix).max()
with wave.open("audio/soundtrack.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("ok", N / SR, "s")
