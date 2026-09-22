# Data dictionary

The master data version is `master@2026.09.1` (`src/lib/domain/master.ts`). The final tag lists, units and polling rates are confirmed during the ATGL site discovery (Section 6). Until then the synthetic feeds below stand in for them.

## Canonical identifiers

| Entity | Pattern | Example |
| --- | --- | --- |
| Zone | 3 letters | `AHD` Ahmedabad, `VAD` Vadodara, `FBD` Faridabad, `KHJ` Khurja, `UDR` Udaipur |
| Site | `ZONE-TYPE-NN` where TYPE ∈ CGS, MS (mother), OS (online), DB (daughter booster), OFF | `AHD-MS-01` |
| Compressor / motor | `SITE-CMP-n` / `SITE-MTR-n` | `AHD-MS-01-CMP-2` |
| Other assets | `SITE-DSP-1`, `SITE-PMP-1`, `SITE-TRF-1`, `SITE-CHL-1` | `AHD-OFF-01-CHL-1` |
| Meters | `SITE-FM-1` fiscal inlet, `-DM-1` district, `-IM-n` industrial/commercial, `-CM-1` CNG dispense | `VAD-CGS-01-IM-2` |
| Pipeline segment | `ZONE-SEG-ST-nn` steel, `ZONE-SEG-PE-nn` MDPE | `VAD-SEG-ST-02` |
| AMC contract | `AMC-...` | `AMC-CMP-BAUER` |

## Feeds and units

| Connector | Measure | Unit | Frequency | Notes |
| --- | --- | --- | --- | --- |
| scada-historian | Compressor energy | kWh per hour | hourly | Flag `gap` when historian returns empty frames |
| | CNG compressed | kg per hour | hourly | |
| | Suction / discharge pressure | bar(g) | hourly | |
| | Vibration | mm/s RMS | hourly | ISO 10816: B > 2.8, C > 4.5 |
| | Bearing temperature | °C | hourly | |
| | Station auxiliary load | kWh per hour | hourly | |
| | Cascade inventory | kg | point in time | |
| rtu-ot | Meter flow | SCMH | 1 min (mirrored) | |
| | Meter drift vs check meter | % | daily | Watch ≥ 0.75%, fault ≥ 1.5% |
| scada-gas-balance | Zone input, outputs by category, linepack | SCM per gas day (06:00 to 06:00 IST) | daily | |
| erp-billing | Discom bills | kWh, kVA, PF, INR | monthly | Source PDF reference retained |
| maintenance-amc | Work orders, payments | timestamps, INR | 15 min | |
| gis-safety | CP ON potential | V vs CSE | daily | Criterion ≤ −0.85 V |
| | Excavation, leak, patrol, emergency events | event | hourly | |

## Key calculations (versioned in `CALC`)

| Version | Formula |
| --- | --- |
| `energy-sec@1.3.0` | SEC = (compression kWh + auxiliary kWh) ÷ kg compressed; benchmark = best-quartile station SEC in scope (4+ stations) |
| `gas-balance@2.1.0` | UAG = input − (CNG + domestic + industrial + commercial) − Δlinepack |
| `uag-attribution@1.0.2` | UAG split across metering error, leakage, billing lag, linepack estimate and unexplained, using the assumptions shown in the UI |
| `meter-drift@1.1.0` | Revenue exposure per day = \|drift\| × flow × 24 × ₹46.2/SCM (sales meters under-registering at 0.75% or more) |
| `asset-health-model@0.9.4` | Health 0 to 100 from vibration zone, temperature rise vs a 2-week baseline and open breakdowns; confidence from sample completeness |
| `billing-recon@1.2.0` | Exceptions: \|billed − measured\| > 2%, MD > contract demand, PF < 0.90, tariff category mismatch |
| `vendor-sla@1.0.0` | Compliance = work orders responded within SLA ÷ responded; breach below 80% |
| `cp-criteria@1.0.0` | A test point fails when its potential is less negative than −0.85 V |

Commercial assumptions used for indicative values (`ASSUMPTIONS`): energy ₹7.35/kWh, gas cost ₹38.5/SCM, industrial gas price ₹46.2/SCM.

## Injected scenarios (synthetic data only)

| Scenario | Entity | Detected by |
| --- | --- | --- |
| Degrading compressor (vibration, temperature, SEC ramp over 12 days) | `AHD-MS-01-CMP-2` | Reliability, energy |
| Pressure-starved station (low suction) | `FBD-OS-01` | Energy |
| High UAG zone | `VAD` | Gas/UAG |
| Under-registering industrial meter (−2.1% or worse) | `VAD-CGS-01-IM-2` | Opportunity, metering |
| Stale RTU (GPRS link down) | `KHJ-DB-01` | Data quality |
| 7-hour historian gap | `UDR-OS-01-CMP-1` | Data quality |
| Unit mismatch on a pressure tag | `FBD-CGS-01-DM-1` | Data quality |
| Over-billed energy (+8.7%) | `UDR-OS-01` | Billing |
| Demand over contract | `AHD-MS-01` | Billing |
| Power factor penalty | `FBD-MS-01` | Billing |
| Tariff category mismatch | `KHJ-OS-01` | Billing |
| CP under-protection | `VAD-SEG-ST-02` | Safety |
| Open leak finding | `VAD-SEG-PE-02` | Safety |
| Unpermitted excavation cluster | `AHD` | Safety |
| AMC SLA breach | `AMC-CMP-BAUER` | Opportunity (vendor) |
| AMC contract expiring | `AMC-HVAC` | Opportunity (vendor) |

These scenarios are the golden set in `tests/golden.test.ts`.

## Application tables (SQLite)

`users`, `sessions`, `audit_log`, `alerts`, `opportunities`, `agent_runs`, `dq_issues`, `copilot_log` and `request_metrics`. The schema is in `src/lib/server/db.ts`. No OT data is persisted; figures are recomputed from the connectors, and only workflow state and evidence snapshots are stored.
