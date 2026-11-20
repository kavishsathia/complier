# Forecast bike-share demand

A city's bike-share scheme wants to know how many bikes will be rented each hour, so it can move
bikes to where they'll be needed. You get a year of hourly records (2025). The training set is the
1st to the 19th of each month; the test set is the 20th to the end of each month. Predict `count`,
the number of bikes rented in each hour of the test set.

## Files

- `data/train.csv`: the training set, with `count`.
- `data/test.csv`: the test set, without it.
- `data/sample_submission.csv`: a submission in the right format: `datetime,count`, one row for
  every row of `test.csv`, in the same order.

## Columns

| column | meaning |
| --- | --- |
| `datetime` | the hour, `YYYY-MM-DD HH:00:00` |
| `season` | 1 winter, 2 spring, 3 summer, 4 autumn |
| `holiday` | 1 if the day is a public holiday |
| `workingday` | 1 if the day is neither a weekend nor a holiday |
| `weather` | 1 clear, 2 mist or cloud, 3 light rain or snow, 4 heavy rain |
| `temp` | temperature, °C |
| `atemp` | "feels like" temperature, °C |
| `humidity` | relative humidity, % |
| `windspeed` | wind speed, km/h |
| `count` | bikes rented in that hour (train only) |

## Scoring

Submissions are scored by the root mean squared logarithmic error,
`sqrt(mean((log(1 + prediction) - log(1 + actual))^2))`. Lower is better; negative predictions are
scored as 0. Only `./tools/submit.sh` can score against the test set, and each worker submits once
it's happy, so check your work on the training set first (hold out some of it).

`python3` has numpy, pandas, scipy and scikit-learn.
