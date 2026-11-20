# Makes the fan-out demo's data: a year of hourly bike-share rentals in a made-up city, laid out as
# the bike-sharing competitions are. Train is the 1st to the 19th of each month, with the count;
# test is the 20th to the end, without it; the test counts go to answers/, which only the scorer
# reads. Deterministic: the same seed always gives the same files.
#
#   python3 answers/make_data.py        (from the demo's folder)
#
# Demand is two kinds of rider. Commuters ride on working days, peaking at 8:00 and 17:30. Leisure
# riders ride in the middle of the day, far more at weekends and on holidays and when it's warm.
# Both drop with rain, humidity and cold, and the scheme grows through the year. Counts are noisy
# (gamma-Poisson), so no model gets them exactly.

import csv
import os
from datetime import datetime, timedelta

import numpy as np

rng = np.random.default_rng(20251120)
here = os.path.dirname(os.path.abspath(__file__))
data = os.path.join(here, "..", "workspace", "data")

HOLIDAYS = {"2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-07-04",
            "2025-09-01", "2025-10-13", "2025-11-11", "2025-11-27", "2025-12-25", "2025-12-26"}

start = datetime(2025, 1, 1)
hours = [start + timedelta(hours=i) for i in range(365 * 24)]
n = len(hours)

# Weather: a Markov chain over 1 clear, 2 mist, 3 light rain or snow, 4 heavy rain.
P = np.array([[0.93, 0.05, 0.02, 0.00],
              [0.12, 0.80, 0.07, 0.01],
              [0.05, 0.20, 0.70, 0.05],
              [0.02, 0.18, 0.40, 0.40]])
weather = np.zeros(n, dtype=int)
for i in range(1, n):
    weather[i] = rng.choice(4, p=P[weather[i - 1]])
weather += 1

doy = np.array([h.timetuple().tm_yday for h in hours])
hour = np.array([h.hour for h in hours])
seasonal = 14 - 11 * np.cos(2 * np.pi * (doy - 20) / 365)
daily = 4.5 * np.sin(2 * np.pi * (hour - 9) / 24)
drift = np.zeros(n)
for i in range(1, n):
    drift[i] = 0.97 * drift[i - 1] + rng.normal(0, 0.45)
temp = seasonal + daily + drift - 1.5 * (weather >= 3)
humidity = np.clip(62 - 1.1 * daily + 9 * (weather == 2) + 22 * (weather >= 3) + rng.normal(0, 8, n), 15, 100)
windspeed = np.clip(rng.gamma(2.2, 5.5, n) + 4 * (weather >= 3), 0, 57)
atemp = temp - 0.12 * np.maximum(windspeed - 10, 0) + 0.04 * np.maximum(humidity - 60, 0) * (temp > 22)

workingday = np.array([h.weekday() < 5 and h.strftime("%Y-%m-%d") not in HOLIDAYS for h in hours])
holiday = np.array([h.strftime("%Y-%m-%d") in HOLIDAYS for h in hours])
season = np.array([((h.month % 12) // 3) + 1 for h in hours])  # 1 winter, 2 spring, 3 summer, 4 autumn


def bump(h, at, width):
    return np.exp(-0.5 * ((h - at) / width) ** 2)


comfort = np.exp(-0.5 * ((atemp - 24) / 9) ** 2)
wet = np.array([1.0, 0.82, 0.42, 0.12])[weather - 1]
muggy = 1 - 0.006 * np.maximum(humidity - 55, 0)
growth = 1 + 0.45 * doy / 365

commute = workingday * (330 * bump(hour, 8, 1.1) + 290 * bump(hour, 17.5, 1.4) + 60 * bump(hour, 13, 3.5) + 18)
commute_mood = 0.55 + 0.45 * comfort
leisure_day = np.where(workingday, 70, 230) * bump(hour, 14.5, 3.2) + np.where(workingday, 10, 25) * bump(hour, 21, 2)
leisure_mood = comfort ** 1.6
night = 6 + 10 * (hour >= 22)

mean = (commute * commute_mood + leisure_day * leisure_mood + night) * wet * muggy * growth
shape = 9.0
count = rng.poisson(rng.gamma(shape, mean / shape))

os.makedirs(data, exist_ok=True)
columns = ["datetime", "season", "holiday", "workingday", "weather", "temp", "atemp", "humidity", "windspeed"]


def row(i):
    return [hours[i].strftime("%Y-%m-%d %H:%M:%S"), int(season[i]), int(holiday[i]), int(workingday[i]), int(weather[i]),
            round(float(temp[i]), 2), round(float(atemp[i]), 2), int(round(float(humidity[i]))), round(float(windspeed[i]), 2)]


train = [i for i in range(n) if hours[i].day <= 19]
test = [i for i in range(n) if hours[i].day > 19]
with open(os.path.join(data, "train.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(columns + ["count"])
    for i in train:
        w.writerow(row(i) + [int(count[i])])
with open(os.path.join(data, "test.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(columns)
    for i in test:
        w.writerow(row(i))
with open(os.path.join(here, "test_counts.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["datetime", "count"])
    for i in test:
        w.writerow([hours[i].strftime("%Y-%m-%d %H:%M:%S"), int(count[i])])
with open(os.path.join(data, "sample_submission.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["datetime", "count"])
    for i in test:
        w.writerow([hours[i].strftime("%Y-%m-%d %H:%M:%S"), 0])

print(f"train {len(train)} rows, test {len(test)} rows, mean count {count.mean():.0f}, max {count.max()}")
