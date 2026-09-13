# Greek Fires

A map of where Greece burned this year, built from Copernicus EFFIS satellite data.

Live at https://wildfires.themos.dev

Drag the timeline and the map walks through the fire season a day at a time. Flames mark
what the satellites caught that day, drawn larger the more of the fire was alight. Burn
scars stay behind once a fire has started, so playing the season through shows the damage
piling up from January to today. Click a scar for how much it took, where, when it
started, and what was growing there.

The strip behind the timeline is the shape of the year: one bar per day, tall where Greece
was burning. Most of it is flat. August is not.

Tap anywhere for the fire danger there today and tomorrow — the EFFIS Fire Weather Index,
forecast by ECMWF — or use the crosshair to ask about where you are.

Alongside the running total is how the year is going against the nine seasons EFFIS has
mapped, compared day for day — so 1 August 2026 reads as 1.8× the average for the date,
and by mid-September the same year has fallen back to two thirds of it.

## What counts as a fire

Not every hotspot is a wildfire. A VIIRS detection is a 375 m pixel that came back hot,
and plenty of them are refinery flares, steel mills or a field being cleared. EFFIS
filters these out of its own portal but does not serve the filtered layer, so the same
judgement happens here: sites that recur across the year are masked as industrial, and a
detection has to be confirmed by a second one nearby before it counts. That drops about a
quarter of the season — 88% of May, 10% of August — while keeping all but 6 of the 3,211
detections that fall inside a burnt-area perimeter EFFIS mapped by hand. See
`lib/wildfire-filter.ts`.

Data: European Forest Fire Information System (EFFIS), Copernicus Emergency Management
Service, (c) European Union. CC BY 4.0.
