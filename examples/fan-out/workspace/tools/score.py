# Scores a submission against the test set's counts (../answers/test_counts.csv, which only this
# script reads): prints the RMSLE, or why the submission is invalid (and exits 1).
import csv
import math
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
answers = os.path.join(here, "..", "..", "answers", "test_counts.csv")
with open(answers) as f:
    truth = [(r["datetime"], float(r["count"])) for r in csv.DictReader(f)]
try:
    with open(sys.argv[1]) as f:
        rows = list(csv.DictReader(f))
    if not rows or set(rows[0]) != {"datetime", "count"}:
        raise ValueError("the columns must be datetime,count")
    if len(rows) != len(truth):
        raise ValueError(f"{len(rows)} rows; the test set has {len(truth)}")
    total = 0.0
    for (when, actual), row in zip(truth, rows):
        if row["datetime"] != when:
            raise ValueError(f"row for {row['datetime']} where {when} was expected: keep test.csv's order")
        p = float(row["count"])
        if math.isnan(p):
            raise ValueError(f"no prediction for {when}")
        total += (math.log1p(max(p, 0)) - math.log1p(actual)) ** 2
    print(f"{math.sqrt(total / len(truth)):.5f}")
except Exception as e:
    print(e)
    sys.exit(1)
