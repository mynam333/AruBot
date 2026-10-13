# Roulette Material Redesign

## Scope

Keep all 16 saved theme identifiers, legacy aliases, reel/wheel choices, tokens,
server-authoritative results, deterministic stop positions and queued execution.
Participation wheels are a separate feature and are not changed.

## Findings And Direction

Previously most themes shared a dark glossy circle, diamond pointer, heavy white
text outline and small result hub. Light materials lost their identity; long
results competed with the wheel name and requester inside the hub. Reel skins
mostly changed colors without changing their construction.

| Theme | Material and silhouette | Lettering and result treatment |
| --- | --- | --- |
| Studio | White/graphite broadcast instrument, red index and calibrated rim | Crisp sans, red tally indicator |
| Prism | Folded blue/coral/lemon facets, polygonal bezel | Bold sans, cut-paper result strip |
| Aurora | Deep emerald with flowing mint ribbons | Open sans, softly curved illuminated rail |
| Velvet | Crimson plush, scalloped gold theater trim | Serif, theatrical result plaque |
| Mono | Flat black/white editorial dial, strict lines | Large sans, double-rule result |
| Deco | Black and antique gold stepped architecture | Serif, fan and stepped corners |
| Crystal | Ice-white cut glass and silver facets | Dark blue sans, crystalline panel |
| Ink | Light paper, irregular charcoal sweep, red seal | Korean serif, understated paper result |
| Nova | Black/copper/cyan astronomical instrument | Instrument sans, orbital measurements |
| Ceramic | White/cobalt porcelain, scalloped china rim | Korean serif, blue painted borders |
| Arcade | Black/yellow/red/teal pixel cabinet | Self-hosted pixel face, stepped frame |
| Sakura | Pale blush and wine folding fan | Korean serif, folded paper and petal edge |
| Ocean | Maritime porthole, brass fasteners and turquoise water | Clear sans, riveted result plate |
| Solar | Orange/red/white corona, radial teeth | Heavy sans, angular solar ticket |
| Cyber | Black/cyan/magenta/lime circuitry, notched corners | Technical sans, circuit-rail result |
| Gold | Emerald/champagne engraved casino coin and laurel | Serif, engraved award plaque |

## Shared Rules

- Wheel title and requester sit above the wheel; the complete winning text has
  its own fitted result area below it. The hub only communicates spin/settled state.
- Wheel sector labels use measured content density and palette-aware contrast.
- Reel row height is fixed independently of text length. Complete labels fit
  their slot; text sizing must never change the computed stopping position.
- Title, requester and result areas have stable dimensions at desktop and narrow
  OBS sizes. No negative tracking or viewport-based font scaling.
- Color, geometry, pattern and lettering identify a theme together; decorative
  animation remains peripheral, bounded and respects reduced motion.
- No remote font requests at runtime. Galmuri and Gowun Batang are self-hosted,
  with original OFL notices in `public/fonts/roulette`.

## Material Refinement

The wheel, title plaque, central emblem and result plaque now share the same
material vocabulary. Fine inset borders, bevel highlights and restrained edge
ornaments add depth without covering sector labels. Paper/mono keep flat inked
surfaces; porcelain uses a pale glaze and cobalt details; metal and glass retain
directional highlights instead of a uniform glow across every theme.

Winning labels are centered beneath a small status caption. Side ornaments occupy
reserved gutters, so long names never compete with them. Small overlay sizes use
smaller ornaments and fixed text slots rather than cropping the winning label.
Decorative states do not change the weighted geometry, stop position or result
acknowledgement. Reduced-motion and inactive-overlay behavior remain respected.

## Independent Theme Artwork

Each of the 16 themes owns one module under `src/components/rouletteThemes`.
The registry supplies a matched rim, single-tip pointer, panel ornament, hub
emblem and picker swatch, with optional palette and material-token overrides.
The viewer and picker apply these overrides over the base material; omitted
values retain the base palette and tokens. Theme-local CSS is
scoped to its presentation attribute. Shared weighted sectors, text fitting,
motion curves and queue acknowledgement remain outside these modules.

Rim artwork uses a 1000-square viewBox with center (500, 500), a clear aperture
below radius 414 and outer bounds no greater than radius 496. Pointer artwork
uses a 180-by-200 viewBox and the same winning tip at (90, 190) in every theme.
Panel artwork uses a 100-square viewBox and describes the left side only; the
host mirrors it on the right and clips each side to at most 20% of the panel,
keeping the middle 60% free of ornaments. Hub emblems use a 48-square viewBox
and picker swatches a 64-square viewBox; neither contains text.
Gradient and clipping IDs belong to each mounted instance. Small static motifs
are ID-free so repeated previews cannot steal one another's paint references.
The shared opaque backing is limited to radius 417 beneath the inner aperture;
only theme artwork determines the outer silhouette. This prevents a circular or
rounded-square legacy background from filling the new cutouts.

The construction distinguishes the themes beyond color: calibrated studio
hardware, folded prism facets, aurora silk, velvet embroidery, monochrome print
registration, stepped deco fans, cut quartz, brush ink, an observatory astrolabe,
cobalt porcelain, a pixel cabinet, a silk folding fan, a nautical porthole,
an enamel solar corona, circuit traces and an engraved casino medallion.
All still use the existing saved theme names and legacy aliases.

Font sources: [Galmuri](https://github.com/quiple/galmuri) and
[Gowun Batang](https://github.com/yangheeryu/Gowun-Batang), plus
[Pretendard](https://github.com/orioncactus/pretendard).

## Spin Direction

Each material has its own acceleration duration, cruise duration, braking curve,
turn count, pointer stiffness and reel-track recoil. Light ink/sakura/aurora glide;
velvet/gold/ocean carry more inertia; studio/mono stop precisely; arcade/solar
launch quickly and run longer at speed. Cyber uses a fixed electronic index.

Both renderers use the same continuous velocity model with exact endpoints.
Wheel keyframes remain compositor-driven; sector-contact pointer motion is a
small transform driven by the same curve. Reel motion blur is limited to fast
travel and clears completely before stopping. Recoil moves the frame, never the
winning row. No near-miss manipulation or winner-changing overshoot is used.
Reduced motion keeps the configured waiting duration but removes large movement.

## Weighted Wheel

The server publishes the ordered labels, effective weights and selected entry
index. Sector angles, labels, highlighting, pointer contacts and stopping geometry
share `createWheelSegments`. Duplicate labels remain distinct. Each stop uses a
seeded random position within the winning sector, leaving 14% boundary padding
on both sides. No equal-width minimum distorts small probabilities; exceptionally
small sectors omit their labels while the complete winning text remains visible.
Old payloads without weights still render equal sectors.

## Chained Results

Result values share a trusted special-variable renderer. Other roulettes and the
same roulette can be queued without skipping the settled result display. A
single execution root allows at most five runs of each roulette, including its
first run. The limit covers sibling branches, intermediate roulettes and queued
continuations across workers. Command and blueprint cycle guards remain strict.
See [result action contracts](roulette-result-actions.md) for supported variables.

## Verification Boundary

Inspect all 32 theme/layout combinations with a local WebSocket fixture using the
real viewer. Check narrow and landscape layouts, long text, spin-to-result
alignment and reduced motion. Fixtures use `시청자 1` and cannot mutate production
data. Local browser checks do not establish live OBS playback after deployment.

The artwork refinement passed all 268 roulette tests across 21 suites, TypeScript
and scoped ESLint. Local Chrome checks covered all 32 theme/layout combinations,
SVG bounds and clear apertures, plus six motion, long-label and mobile cases.
The final design review approved the corrected outer silhouettes and internal
seat. These results do not establish live OBS playback or production deployment.
