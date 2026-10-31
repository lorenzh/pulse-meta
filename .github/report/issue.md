Factory report of pulse. Opened by `factory-report-open.yml`, which starts the `report` workflow at once (label `factory/report/report`). To stop it, cancel its `Factory run` workflow run and remove the `factory/report/` label.

## Data

The opener built `report/data.json` with `report/data.mjs` and uploaded it as the Actions artifact `report-data`. The agent commits that file unchanged.

as-of: {as_of}
data-run: {run_id}
data-sha256: {sha256}
fingerprint: {fingerprint}
previous-as-of: {previous_as_of}

## Result

The `report` workflow writes `report/data.json` (the artifact, unchanged) and `report/narrative.json` (the text) and opens one report pull request. `report/check.mjs` must pass, and `report-review` checks every claim against the data. Merging the pull request publishes the page; `factory-report.yml` then closes this issue.
