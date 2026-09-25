# Vertex Forge

A 2D geometry graphing studio that runs in the browser. Draw lines and shapes, set exact side lengths, angles and radii, inscribe shapes inside each other, snap lines to points, measure areas, and share a graph with a short code.

**Live:** https://fanaustinca.github.io/vertexforge/

## Features

- **Lines**: set the boldness, color and pattern (solid, dashed, dotted, dash-dot). A line can be a segment, a ray or an infinite line, with optional arrowheads. Right-click a line to type an exact length and angle.
- **Shapes with 1–20 sides**: 1 is a circle, 2 is a semicircle and 3–20 are regular polygons. Click to insert one, or draw one with the Shape tool.
- **Resize box**: drag the handles to change width and height, or drag the round handle to rotate.
  - Hold **Shift** to keep a perfect regular polygon or circle.
  - Hold **Ctrl** to scale without changing the proportions.
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
- **Function graphing**: type an expression such as `x^2 - 3`, `2sin(x)` or `sqrt(9 - x^2)`. A small parser reads it; the app never runs `eval`.
- **Save and share**: save named graphs in the browser, or create a share code or link. The code is compressed JSON, and every object is checked when it's loaded.
- **Settings and Help**: both have a search bar. Settings has 48 options, and Help has 28 topics.
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
| `js/expr.js` | safe math-expression compiler |
| `js/data.js` | settings schema, special shapes, help topics |
| `js/app.js` | rendering, interaction and UI |
