# Vertex Forge

A 2D geometry graphing studio that runs in the browser. Draw lines and shapes, set exact side lengths, angles and radii, inscribe shapes inside each other, snap lines to points, measure areas, and share a graph with a short code.

**Live:** https://fanaustinca.github.io/vertexforge/

## Features

- **Lines**: set the boldness, color and pattern (solid, dashed, dotted, dash-dot). A line can be a segment, a ray or an infinite line, with optional arrowheads. Right-click a line to type an exact length and angle.
- **Shapes with 1–20 sides**: 1 is a circle, 2 is a semicircle and 3–20 are regular polygons. Click to insert one, or draw one with the Shape tool.
- **Resize box**: drag the handles to change width and height, or drag the round handle to rotate.
  - Hold **Shift** or **Ctrl** to keep the proportions. Regular polygons and circles stay perfect, and other shapes (a parallelogram, a star) keep their exact form.
- **Scale by a value**: type a factor in the Properties panel, use the ½× and 2× buttons, or pick **Scale…** to reach a target area, perimeter, width, height or length. The 🔗 lock keeps width and height in proportion when you type them.
- **Exact side lengths and angles**: right-click a polygon to type them in. The app checks the values and shows an error when they can't form a valid shape: the angle sum is wrong, one side is too long, the sides and angles don't close, or the edges cross.
- **Radius**: right-click a circle, oval or semicircle to set its radius.
- **Inscribed shapes**: right-click a shape and pick Inscribe to place the largest circle, oval, square, rectangle or 1–20 sided polygon that fits inside. The inscribed shape updates when its parent changes.
- **Snap points**: right-click a shape and choose Snap points to add purple points spaced evenly around its outline. The default is 0. New lines and points snap onto them. They also snap to corners, centers and line endpoints.
- **Grid**: turn it on or off, set the spacing and major lines, and snap to the grid if you want.
- **Special shapes**: 30-60-90, 45-45-90, the golden triangle and golden gnomon, the Kepler triangle, Pythagorean triples, golden and silver rectangles, rhombus, kite, dart, trapezoids, pentagram, hexagram and more.
- **Tools you turn on**:
  - **Right △** labels the legs and hypotenuse of every right triangle and adds a solver.
  - **Area** labels each shape's area, and its perimeter if you choose.
  - **Measure** shows the distance and angle between two points.
  - Decimal places, units, label position and colors are set in Settings.
- **Polygon and Angle tools**: click corner by corner to draw any polygon. For an angle, click a point on one arm, the vertex, then a point on the other arm: the mark shows just its arc and value, and it sticks to the sides and corners you clicked, so it updates when they move.
- **Smarter snapping**: points snap to intersections of lines, sides and circles, to midpoints, and to any point along an outline. A tag near the cursor shows what it snapped to.
- **Constructions**:
  - Triangles: medians and the centroid, altitudes and the orthocenter, angle bisectors and the incenter, perpendicular bisectors and the circumcenter, plus the circumcircle, incircle, nine-point circle and Euler line.
  - Any polygon: its diagonals, side midpoints and the smallest enclosing circle.
  - Lines: the midpoint, the perpendicular bisector, parallel or perpendicular lines through a point you click, and a square or equilateral triangle built on the segment.
- **Transformations**: flip, rotate by 90° or any angle, scale, move by a vector, or reflect across a line you click.
- **Shape type and corners**: the panel names each shape (for example "right isosceles triangle", "rhombus" or "isosceles trapezoid"), and you can type exact corner coordinates.
- **Objects panel**: every object is listed. Click one to select it; it flashes on the canvas, and the view moves to it if it's off screen. Each row has hide, lock and delete buttons.
- **SVG export**, alongside PNG.
- **More kinds of graph**: equations in x and y (`x^2 + y^2 = 9`), shaded inequalities (`y > x^2`), polar curves (`r = 1 + cos(θ)`) and parametric curves (`(cos t, sin 2t)`).
- **Calculus**:
  - Exact symbolic derivatives that stay up to date.
  - Shaded integrals: the area under a curve or between two graphs, with exact values such as 8/3.
  - A tangent line whose point you drag along the curve.
  - Roots, turning points, the y-intercept and intersections, which follow the graph.
  - `solve`, `derivative` and `integrate` in the command bar.
- **Building from points**:
  - Lines and polygons drawn between points stay attached to them.
  - Right-click a point for a segment, line or circle through another point, or a midpoint.
  - A point dropped on an object slides along it (a glider).
  - Intersection points stay live.
- **Sliders drive anything**: type `2a` or `cos(t)` into a radius, width, rotation, position or arc angle to drive it with a slider.
- **Traces and loci**: leave a trail as something moves, or draw the whole path a point follows (for example a cycloid).
- **Data and statistics**:
  - Summary numbers (mean, median, mode, quartiles, IQR, σ and outliers).
  - Dot plots, box plots, histograms and scatter plots, with a line of best fit and r.
  - Probability functions such as `normalpdf`, `normalcdf`, `binompdf` and `nCr`.
- **Examples library**: 12 ready-made graphs to explore.
- **50-60-70 scalene triangle** among the special shapes.
- **Daily puzzle** (a small easter egg: click the logo): a new geometry puzzle every day, generated from the date. It uses real theorems: AIA, SSIA, corresponding and vertical angles, 30-60-90 and 45-45-90 triangles, the Pythagorean theorem (sometimes twice), Thales, inscribed angles, tangents and similar triangles. Difficulty builds through the week: ★★ on Monday up to ★★★★ from Friday to Sunday. It hides the measuring tools, but you can still draw, construct and graph. Check your answer, get a hint, and keep a streak.
- **Installable and offline**: install it as an app. After the first visit it works without internet.
- **Measurements card** in the left panel: area, perimeter and more for whatever is selected, or the total area when nothing is.
- **Links**: with the Link tool (K) you can keep sides equal, parallel or perpendicular, or angles equal, for good. Change one and the others follow. Linked sides and angles get tick marks, arrows or arcs in their own color. Tick marks also appear automatically on sides and angles that already match.
- **Live constructions**: medians, circumcircles, tangents, arcs, distances and other constructions follow their shape when it moves or changes.
- **Sliders**: letters in a function, such as `y = a·sin(kx)`, become sliders. You can drag them, type exact values like `pi/2`, or animate them.
- **Simplest radical form**: the √ button shows exact values such as √2, 3√3/2, 9π/4, 4 − π and 2π/3 − √3/2.
- **Command bar**: press `/` and type things like `triangle 3 4 5`, `circle r=2 at (1,1)`, `regular 7 side 3` or `y = x^2`.
- **Tangents, arcs, sectors and chords** on circles and ellipses, with exact arc lengths and areas.
- **Overlap areas**: shade the intersection, union or difference of two shapes. The area is exact for polygons, for circles or ellipses overlapping polygons, and for two circles.
- **More measurements**: point-to-line distance, the angle between two lines, line equations, and coordinates shown on hover.
- **Worksheets**: print a practice page with the measurements hidden plus an answer key, on Letter or A4.
- **Touch**: press and hold for the menu, pinch to zoom, twist with two fingers to rotate, larger handles, and floating Undo and Delete buttons.
- **Quick tour** on the first visit.
- **Function graphing**: type an expression such as `x^2 - 3`, `2sin(x)` or `sqrt(9 - x^2)`. A small parser reads it; the app never runs `eval`. Click a function to style it: line style (solid, dashed, dotted or dash-dot), color, thickness and opacity. You can also limit it to a domain, with optional dots at the ends, and label it "y = …" on the graph.
- **Save and share**: save named graphs in the browser, or create a share code or link. The code is compressed JSON, and every object is checked when it's loaded.
- **Settings and Help**: both have a search bar. Settings has 115 options, including interior or exterior angles, handle size, which panels to show and hold-Alt-to-stop-snapping. You can jump to a group, show only the settings you've changed, and reset any one of them. Help has 56 topics.
- Also: undo and redo, copy, paste and duplicate, a selection box, corner editing (double-click a polygon), dark and light themes, PNG export and keyboard shortcuts (press `?` to see them).

## Development

The app is plain static HTML, CSS and ES modules, so there is no build step.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # geometry + expression parser tests (Node 18+)
```

| File | Purpose |
| --- | --- |
| `js/geom.js` | shape model, measurements, side/angle solvers, inscribing |
| `js/construct.js` | triangle centers, enclosing circles, intersections, tangents, classification |
| `js/links.js` | link solver (equal / parallel / perpendicular / equal angles) |
| `js/boolean.js` | exact overlap areas (polygon clipping, circle–polygon, lens) |
| `js/exact.js` | simplest radical form / π recognition |
| `js/commands.js` | command bar parser |
| `js/graphs.js` | implicit curves, inequalities, polar/parametric, integrals, roots |
| `js/stats.js` | statistics and regression |
| `js/puzzle.js` | daily puzzle generator (seeded by the date) |
| `sw.js`, `manifest.json` | offline support and install |
| `js/expr.js` | safe expression engine: parser, compiler, symbolic derivatives |
| `js/data.js` | settings schema, special shapes, help topics |
| `js/app.js` | rendering, interaction and UI |
