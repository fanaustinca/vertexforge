// Static data: settings schema, special shapes, help topics.

const PHI = (1 + Math.sqrt(5)) / 2;
const S3 = Math.sqrt(3);

export const SETTINGS_DEF = [
  // Grid & axes
  { key: 'showGrid', group: 'Grid & Axes', label: 'Show grid', type: 'bool', def: true, desc: 'Draw the background grid. Shortcut: G.' },
  { key: 'gridSize', group: 'Grid & Axes', label: 'Grid spacing (units)', type: 'number', def: 1, min: 0.01, max: 1000, step: 0.25, desc: 'Distance between minor grid lines.' },
  { key: 'gridMajor', group: 'Grid & Axes', label: 'Major line every N cells', type: 'number', def: 5, min: 1, max: 50, step: 1, desc: 'Every Nth grid line is drawn bolder.' },
  { key: 'showAxes', group: 'Grid & Axes', label: 'Show x / y axes', type: 'bool', def: true },
  { key: 'showAxisNumbers', group: 'Grid & Axes', label: 'Show axis numbers', type: 'bool', def: true, desc: 'Numbers along the x and y axes (only shown while the axes are on).' },
  { key: 'showMinor', group: 'Grid & Axes', label: 'Show minor grid lines', type: 'bool', def: true },
  { key: 'gridStyle', group: 'Grid & Axes', label: 'Grid style', type: 'select', def: 'lines', options: [['lines', 'Lines'], ['dots', 'Dots']], desc: 'Dots give a lighter, graph-paper-like background.' },

  // Snapping
  { key: 'snapPoints', group: 'Snapping', label: 'Snap to purple snap points', type: 'bool', def: true, desc: 'Lines and points jump to a shape’s snap points (set per shape with right-click → Snap points).' },
  { key: 'showSnapPoints', group: 'Snapping', label: 'Show snap points', type: 'bool', def: true },
  { key: 'snapVertices', group: 'Snapping', label: 'Snap to shape corners (vertices)', type: 'bool', def: true },
  { key: 'snapCenters', group: 'Snapping', label: 'Snap to circle / shape centers', type: 'bool', def: true },
  { key: 'snapEndpoints', group: 'Snapping', label: 'Snap to line endpoints and points', type: 'bool', def: true },
  { key: 'snapIntersections', group: 'Snapping', label: 'Snap to intersections', type: 'bool', def: true, desc: 'Where lines, sides and circles cross each other.' },
  { key: 'snapMidpoints', group: 'Snapping', label: 'Snap to side & segment midpoints', type: 'bool', def: true },
  { key: 'snapOnOutline', group: 'Snapping', label: 'Snap onto outlines', type: 'bool', def: true, desc: 'When nothing else is close, stick to the nearest point on a side, circle or line.' },
  { key: 'snapGrid', group: 'Snapping', label: 'Snap to grid', type: 'bool', def: false, desc: 'Round new points to the nearest grid intersection when nothing else is close.' },
  { key: 'snapRadius', group: 'Snapping', label: 'Snap distance (pixels)', type: 'number', def: 14, min: 2, max: 60, step: 1 },
  { key: 'snapColor', group: 'Snapping', label: 'Snap point color', type: 'color', def: '#a855f7' },
  { key: 'snapPointSize', group: 'Snapping', label: 'Snap point size (px)', type: 'number', def: 4.5, min: 2, max: 10, step: 0.5 },
  { key: 'altDisablesSnap', group: 'Snapping', label: 'Hold Alt to turn snapping off', type: 'bool', def: true, desc: 'While Alt is held, points go exactly where the cursor is.' },
  { key: 'showSnapTag', group: 'Snapping', label: 'Show what you snapped to', type: 'bool', def: true, desc: 'A small tag like “intersection” or “midpoint” next to the cursor.' },

  // Measurements & labels
  { key: 'decimals', group: 'Measurements', label: 'Decimal places', type: 'number', def: 2, min: 0, max: 10, step: 1, desc: 'How many decimal places lengths, angles and areas are shown to.' },
  { key: 'units', group: 'Measurements', label: 'Unit label', type: 'text', def: '', desc: 'Optional unit written after measurements, e.g. cm or in.' },
  { key: 'angleUnit', group: 'Measurements', label: 'Angle unit', type: 'select', def: 'deg', options: [['deg', 'Degrees'], ['rad', 'Radians']] },
  { key: 'sideLabels', group: 'Measurements', label: 'Side length labels', type: 'select', def: 'selected', options: [['never', 'Never'], ['selected', 'Selected shape'], ['always', 'All shapes']] },
  { key: 'angleKind', group: 'Measurements', label: 'Which angles to show', type: 'select', def: 'interior', options: [['interior', 'Interior angles'], ['exterior', 'Exterior angles'], ['both', 'Interior and exterior']], desc: 'Exterior angles are drawn against a dotted extension of the previous side.' },
  { key: 'showAngleArcs', group: 'Measurements', label: 'Draw angle arcs', type: 'bool', def: true },
  { key: 'rightAngleMarks', group: 'Measurements', label: 'Mark right angles with a square', type: 'bool', def: true },
  { key: 'labelBackground', group: 'Measurements', label: 'Label backgrounds', type: 'bool', def: true, desc: 'Draw measurement labels on a small card so they stay readable.' },
  { key: 'trimZeros', group: 'Measurements', label: 'Hide trailing zeros', type: 'bool', def: false, desc: 'Show 4 instead of 4.00 and 2.5 instead of 2.50.' },
  { key: 'angleLabels', group: 'Measurements', label: 'Angle labels', type: 'select', def: 'selected', options: [['never', 'Never'], ['selected', 'Selected shape'], ['always', 'All shapes']] },
  { key: 'vertexNames', group: 'Measurements', label: 'Show vertex letters (A, B, C…)', type: 'bool', def: false },
  { key: 'labelSize', group: 'Measurements', label: 'Label text size (px)', type: 'number', def: 12, min: 8, max: 28, step: 1 },

  // Tools
  { key: 'areaShowPerimeter', group: 'Tools', label: 'Area tool also shows perimeter', type: 'bool', def: false },
  { key: 'areaPosition', group: 'Tools', label: 'Area label position', type: 'select', def: 'center', options: [['center', 'Center of shape'], ['above', 'Above shape'], ['below', 'Below shape']] },
  { key: 'areaColor', group: 'Tools', label: 'Area label color', type: 'color', def: '#34d399' },
  { key: 'rightTriAngles', group: 'Tools', label: 'Right-triangle tool shows acute angles', type: 'bool', def: true },
  { key: 'rightTriFormula', group: 'Tools', label: 'Right-triangle tool shows a² + b² = c²', type: 'bool', def: true },
  { key: 'rightTriColor', group: 'Tools', label: 'Right-triangle label color', type: 'color', def: '#fbbf24' },
  { key: 'angleColor', group: 'Tools', label: 'Angle tool color', type: 'color', def: '#22d3ee' },
  { key: 'rightTriTolerance', group: 'Tools', label: 'Right-angle tolerance (degrees)', type: 'number', def: 0.01, min: 0.0001, max: 5, step: 0.01, desc: 'How close to 90° an angle must be to count as a right angle.' },

  // Shapes
  { key: 'defaultSnapN', group: 'Shapes', label: 'Snap points on new shapes', type: 'number', def: 0, min: 0, max: 200, step: 1, desc: 'How many purple snap points newly inserted shapes start with.' },
  { key: 'defaultSize', group: 'Shapes', label: 'Default shape size (units)', type: 'number', def: 4, min: 0.1, max: 1000, step: 0.5 },
  { key: 'shapeStroke', group: 'Shapes', label: 'New shape outline color', type: 'color', def: '#38bdf8' },
  { key: 'shapeWidth', group: 'Shapes', label: 'New shape outline width', type: 'number', def: 2, min: 0.5, max: 20, step: 0.5 },
  { key: 'shapeFill', group: 'Shapes', label: 'New shape fill color', type: 'color', def: '#38bdf8' },
  { key: 'shapeFillAlpha', group: 'Shapes', label: 'New shape fill opacity', type: 'number', def: 0.12, min: 0, max: 1, step: 0.05 },
  { key: 'constructColor', group: 'Shapes', label: 'Construction line color', type: 'color', def: '#94a3b8', desc: 'Medians, bisectors, diagonals and other constructions.' },
  { key: 'constructWidth', group: 'Shapes', label: 'Construction line width', type: 'number', def: 1.5, min: 0.5, max: 10, step: 0.5 },
  { key: 'constructDash', group: 'Shapes', label: 'Construction line style', type: 'select', def: 'dashed', options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['dashdot', 'Dash-dot']] },
  { key: 'inscribeColor', group: 'Shapes', label: 'Inscribed shape color', type: 'color', def: '#facc15' },
  { key: 'inscribeFollow', group: 'Shapes', label: 'Inscribed shapes follow their parent', type: 'bool', def: true, desc: 'When the outer shape changes, the inscribed shape is recalculated.' },
  { key: 'shiftMode', group: 'Shapes', label: 'Holding Shift while resizing', type: 'select', def: 'keep', options: [['keep', 'Keeps the shape’s proportions'], ['regular', 'Forces a regular polygon / circle']], desc: 'Keeping proportions means regular shapes and circles stay perfect, and other shapes (like a parallelogram) keep their exact form.' },
  { key: 'lockAspect', group: 'Shapes', label: 'Lock width & height together when typing', type: 'bool', def: false, desc: 'The 🔗 button next to Width/Height in Properties. When on, typing a new width scales the height to match.' },
  { key: 'scaleAbout', group: 'Shapes', label: 'Scale from', type: 'select', def: 'center', options: [['center', 'The shape’s center'], ['origin', 'The origin (0, 0)']], desc: 'Where the shape stays anchored when you scale it by a value.' },
  { key: 'rotateSnap', group: 'Shapes', label: 'Rotation snap with Shift (degrees)', type: 'number', def: 15, min: 1, max: 90, step: 1 },

  // Lines
  { key: 'lineColor', group: 'Lines', label: 'New line color', type: 'color', def: '#f472b6' },
  { key: 'lineWidth', group: 'Lines', label: 'New line boldness (px)', type: 'number', def: 2.5, min: 0.5, max: 20, step: 0.5 },
  { key: 'lineDash', group: 'Lines', label: 'New line style', type: 'select', def: 'solid', options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['dashdot', 'Dash-dot']] },
  { key: 'lineAngleSnap', group: 'Lines', label: 'Angle snap with Shift (degrees)', type: 'number', def: 15, min: 1, max: 90, step: 1 },
  { key: 'pointColor', group: 'Lines', label: 'New point color', type: 'color', def: '#f472b6' },
  { key: 'pointSize', group: 'Lines', label: 'New point size', type: 'number', def: 3, min: 1, max: 12, step: 0.5 },
  { key: 'textSize', group: 'Lines', label: 'New text size (px)', type: 'number', def: 18, min: 8, max: 96, step: 1 },
  { key: 'funcWidth', group: 'Lines', label: 'New function graph width', type: 'number', def: 2.5, min: 0.5, max: 10, step: 0.5 },
  { key: 'funcDash', group: 'Lines', label: 'New function line style', type: 'select', def: 'solid', options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted'], ['dashdot', 'Dash-dot']] },
  { key: 'funcLabels', group: 'Lines', label: 'Label new functions with “y = …”', type: 'bool', def: false },
  { key: 'showLineLength', group: 'Lines', label: 'Show length while drawing lines', type: 'bool', def: true },

  // Selection & editing
  { key: 'selColor', group: 'Selection & Editing', label: 'Selection & highlight color', type: 'color', def: '#3b82f6' },
  { key: 'handleSize', group: 'Selection & Editing', label: 'Resize handle size (px)', type: 'number', def: 9, min: 6, max: 20, step: 1, desc: 'Bigger handles are easier to grab, especially on touch screens.' },
  { key: 'hoverHighlight', group: 'Selection & Editing', label: 'Highlight objects under the cursor', type: 'bool', def: true },
  { key: 'returnToSelect', group: 'Selection & Editing', label: 'Go back to Select after drawing', type: 'bool', def: false, desc: 'Switch to the Select tool after each line, shape, polygon, point or angle.' },
  { key: 'dblClickAction', group: 'Selection & Editing', label: 'Double-clicking a polygon', type: 'select', def: 'corners', options: [['corners', 'Edits its corners'], ['sides', 'Opens sides & angles'], ['none', 'Does nothing']] },
  { key: 'nudgeStep', group: 'Selection & Editing', label: 'Arrow-key nudge distance (units)', type: 'number', def: 0, min: 0, max: 1000, step: 0.1, desc: '0 = one screen pixel (or one grid cell when snapping to grid). Shift moves 10×.' },
  { key: 'confirmDelete', group: 'Selection & Editing', label: 'Ask before deleting', type: 'bool', def: false },
  { key: 'historyLimit', group: 'Selection & Editing', label: 'Undo steps to remember', type: 'number', def: 300, min: 20, max: 2000, step: 10 },

  // Objects panel
  { key: 'objFlash', group: 'Objects Panel', label: 'Flash the object when clicked in the list', type: 'bool', def: true, desc: 'A pulsing highlight shows you exactly where it is on the canvas.' },
  { key: 'objHover', group: 'Objects Panel', label: 'Highlight while hovering a row', type: 'bool', def: true },
  { key: 'objPanTo', group: 'Objects Panel', label: 'Move the view to the clicked object', type: 'select', def: 'offscreen', options: [['never', 'Never'], ['offscreen', 'Only if it’s off screen'], ['always', 'Always center it']] },
  { key: 'objNewestFirst', group: 'Objects Panel', label: 'Newest (top-most) objects first', type: 'bool', def: true },
  { key: 'objDeleteButton', group: 'Objects Panel', label: 'Show delete buttons in the list', type: 'bool', def: true },

  // Interface
  { key: 'theme', group: 'Interface', label: 'Theme', type: 'select', def: 'dark', options: [['dark', 'Blueprint (dark)'], ['light', 'Paper (light)']] },
  { key: 'showSpecialShapes', group: 'Interface', label: 'Show the Special shapes panel', type: 'bool', def: true },
  { key: 'showObjectsPanel', group: 'Interface', label: 'Show the Objects panel', type: 'bool', def: true },
  { key: 'showFunctionsPanel', group: 'Interface', label: 'Show the Functions panel', type: 'bool', def: true },
  { key: 'showZoom', group: 'Interface', label: 'Show zoom level', type: 'bool', def: true },
  { key: 'zoomToCursor', group: 'Interface', label: 'Zoom toward the cursor', type: 'bool', def: true, desc: 'Off: the mouse wheel zooms around the middle of the screen.' },
  { key: 'toasts', group: 'Interface', label: 'Show pop-up messages', type: 'bool', def: true, desc: 'Errors are always shown.' },
  { key: 'toastSeconds', group: 'Interface', label: 'Pop-up message time (seconds)', type: 'number', def: 2.5, min: 1, max: 10, step: 0.5 },
  { key: 'showCoords', group: 'Interface', label: 'Show cursor coordinates', type: 'bool', def: true },
  { key: 'showHints', group: 'Interface', label: 'Show tool hints', type: 'bool', def: true },
  { key: 'autosave', group: 'Interface', label: 'Autosave current graph', type: 'bool', def: true, desc: 'Keeps your work in this browser between visits.' },
  { key: 'confirmNew', group: 'Interface', label: 'Confirm before clearing the graph', type: 'bool', def: true },
  { key: 'zoomSpeed', group: 'Interface', label: 'Mouse-wheel zoom speed', type: 'number', def: 1, min: 0.2, max: 3, step: 0.1 },
];

// Special shapes: world-space vertex lists (roughly unit scale; they get resized to the default size).
export const PRESETS = [
  { id: 'eq', name: 'Equilateral triangle', desc: 'All sides equal, all angles 60°.', pts: [[0, 0], [2, 0], [1, S3]] },
  { id: 't306090', name: '30-60-90 triangle', desc: 'Sides in ratio 1 : √3 : 2.', pts: [[0, 0], [S3, 0], [0, 1]] },
  { id: 't454590', name: '45-45-90 triangle', desc: 'Isosceles right triangle, sides 1 : 1 : √2.', pts: [[0, 0], [1, 0], [0, 1]] },
  { id: 'golden', name: 'Golden triangle', desc: 'Isosceles 36-72-72; leg : base = φ (golden ratio).', pts: [[0, 0], [1, 0], [0.5, Math.sqrt(PHI * PHI - 0.25)]] },
  { id: 'gnomon', name: 'Golden gnomon', desc: 'Isosceles 36-36-108; base : leg = φ.', pts: [[0, 0], [PHI, 0], [PHI / 2, Math.sqrt(1 - (PHI / 2) ** 2)]] },
  { id: 'kepler', name: 'Kepler triangle', desc: 'Right triangle with sides 1 : √φ : φ.', pts: [[0, 0], [Math.sqrt(PHI), 0], [0, 1]] },
  { id: 't345', name: '3-4-5 triangle', desc: 'The smallest Pythagorean triple.', pts: [[0, 0], [4, 0], [0, 3]] },
  { id: 't51213', name: '5-12-13 triangle', desc: 'Pythagorean triple.', pts: [[0, 0], [12, 0], [0, 5]] },
  { id: 't81517', name: '8-15-17 triangle', desc: 'Pythagorean triple.', pts: [[0, 0], [15, 0], [0, 8]] },
  { id: 't72425', name: '7-24-25 triangle', desc: 'Pythagorean triple.', pts: [[0, 0], [24, 0], [0, 7]] },
  { id: 'iso', name: 'Isosceles triangle', desc: 'Two equal sides (base 2, height 3).', pts: [[0, 0], [2, 0], [1, 3]] },
  { id: 'obtuse', name: 'Obtuse scalene triangle', desc: 'No equal sides, one angle over 90°.', pts: [[0, 0], [4, 0], [-1.2, 1.6]] },
  { id: 'sq', name: 'Square', desc: 'Four equal sides and four right angles.', pts: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  { id: 'goldrect', name: 'Golden rectangle', desc: 'Length : width = φ ≈ 1.618.', pts: [[0, 0], [PHI, 0], [PHI, 1], [0, 1]] },
  { id: 'silver', name: 'Silver (√2) rectangle', desc: 'Length : width = √2, the A4 paper ratio.', pts: [[0, 0], [Math.SQRT2, 0], [Math.SQRT2, 1], [0, 1]] },
  { id: 'rect21', name: '2 : 1 rectangle', desc: 'A domino shape.', pts: [[0, 0], [2, 0], [2, 1], [0, 1]] },
  { id: 'rhombus', name: 'Rhombus (60°)', desc: 'Four equal sides, angles 60° and 120°.', pts: [[0, 0], [1, 0], [1.5, S3 / 2], [0.5, S3 / 2]] },
  { id: 'para', name: 'Parallelogram', desc: 'Opposite sides parallel and equal.', pts: [[0, 0], [3, 0], [4, 1.6], [1, 1.6]] },
  { id: 'kite', name: 'Kite', desc: 'Two pairs of equal adjacent sides.', pts: [[0, 0], [1, 1], [0, 3], [-1, 1]] },
  { id: 'dart', name: 'Dart (concave kite)', desc: 'A kite with one reflex angle.', pts: [[0, 0], [1.2, -0.6], [0, 2.4], [-1.2, -0.6]] },
  { id: 'isotrap', name: 'Isosceles trapezoid', desc: 'One pair of parallel sides, equal legs.', pts: [[0, 0], [4, 0], [3, 2], [1, 2]] },
  { id: 'righttrap', name: 'Right trapezoid', desc: 'A trapezoid with two right angles.', pts: [[0, 0], [4, 0], [2.5, 2], [0, 2]] },
  { id: 'pentagram', name: 'Pentagram (star)', desc: 'Five-pointed star; its points are golden triangles.', pts: star(5, 1, 1 / (PHI * PHI)) },
  { id: 'hexagram', name: 'Hexagram (star)', desc: 'Six-pointed star made of two triangles.', pts: star(6, 1, 1 / S3) },
  { id: 'cross', name: 'Greek cross', desc: 'Twelve-sided plus shape.', pts: [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3], [1, 2], [0, 2], [0, 1], [1, 1]] },
  { id: 'arrow', name: 'Arrow', desc: 'Seven-sided arrow.', pts: [[0, 1], [3, 1], [3, 0], [5, 1.5], [3, 3], [3, 2], [0, 2]] },
];

function star(n, R, r) {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / n;
    const rad = i % 2 ? r : R;
    out.push([rad * Math.cos(a), rad * Math.sin(a)]);
  }
  return out;
}

export const SIDE_NAMES = {
  1: 'Circle', 2: 'Semicircle', 3: 'Triangle', 4: 'Square', 5: 'Pentagon', 6: 'Hexagon', 7: 'Heptagon', 8: 'Octagon',
  9: 'Nonagon', 10: 'Decagon', 11: 'Hendecagon', 12: 'Dodecagon', 13: 'Tridecagon', 14: 'Tetradecagon',
  15: 'Pentadecagon', 16: 'Hexadecagon', 17: 'Heptadecagon', 18: 'Octadecagon', 19: 'Enneadecagon', 20: 'Icosagon',
};

const K = (k) => `<kbd>${k}</kbd>`;

export const HELP = [
  { title: 'Getting started', tags: 'intro basics overview welcome', body: `
    <p>Vertex Forge is a 2D geometry canvas. Pick a tool on the left, draw on the grid, and <b>right-click anything</b> to see what you can do with it.</p>
    <ul><li>Insert a shape from the <b>Shapes</b> panel (1–20 sides) or a <b>Special shape</b>.</li>
    <li>Drag the box handles to resize, drag the round handle to rotate.</li>
    <li>Use the <b>Line</b> tool to connect corners and snap points.</li>
    <li>Save your work with <b>Save</b>, or <b>Share</b> it as a code.</li></ul>` },
  { title: 'Moving around: pan & zoom', tags: 'navigate scroll wheel zoom pan move view reset', body: `
    <p><b>Zoom</b> with the mouse wheel or trackpad pinch, or ${K('+')} / ${K('-')}. <b>Pan</b> by dragging empty space with the Pan tool (${K('H')}), holding ${K('Space')} while dragging, or dragging with the middle mouse button.</p>
    <p>${K('0')} resets the view to the origin. The zoom level is shown bottom-left.</p>` },
  { title: 'Tools overview', tags: 'toolbar select pan line point shape text measure', body: `
    <ul><li><b>Select</b> ${K('V')} — click to select, drag to move, drag on empty space for a selection box, ${K('Shift')}-click to add to the selection.</li>
    <li><b>Pan</b> ${K('H')} — drag to move the view.</li>
    <li><b>Line</b> ${K('L')} — drag (or click, then click again) to draw a line segment.</li>
    <li><b>Point</b> ${K('P')} — click to drop a point.</li>
    <li><b>Shape</b> ${K('S')} — drag a box to draw the current shape; a single click drops a default-size one.</li>
    <li><b>Polygon</b> ${K('N')} — click corner by corner to draw any polygon.</li>
    <li><b>Angle</b> ${K('A')} — click three points to measure and mark an angle.</li>
    <li><b>Text</b> ${K('T')} — click to place a text label.</li>
    <li><b>Measure</b> ${K('M')} — drag to measure distance and angle (nothing is added to the graph).</li></ul>` },
  { title: 'Lines: boldness, color & dashes', tags: 'line segment ray thickness width bold color dashed dotted style arrow', body: `
    <p>With nothing selected, the right panel shows the <b>style for new lines</b>: color, boldness (width in pixels) and pattern (solid, dashed, dotted, dash-dot).</p>
    <p>Select a line to change its own style, make it a <b>ray</b> or an <b>infinite line</b>, or add <b>arrowheads</b>. Right-click a line to type an exact length or angle.</p>
    <p>Hold ${K('Shift')} while drawing to lock the angle to 15° steps (change the step in Settings).</p>` },
  { title: 'Inserting shapes (1–20 sides)', tags: 'polygon insert shapes sides triangle square pentagon hexagon circle semicircle', body: `
    <p>Click any button in the <b>Shapes</b> panel to drop that shape in the middle of the view. 1 side = circle, 2 sides = semicircle (one straight side, one curved), 3–20 = regular polygons.</p>
    <p>Or choose the <b>Shape</b> tool and drag a box on the canvas to draw it at any size.</p>` },
  { title: 'Easy resize box', tags: 'resize bounding box handles width height scale stretch', body: `
    <p>A selected shape shows a rectangular box with 8 square handles. Drag a <b>corner</b> to change width and height together, or a <b>side</b> handle to change just width or just height. The opposite edge stays put.</p>
    <p>You can also type exact <b>W</b> and <b>H</b> values in the Properties panel.</p>` },
  { title: 'Shift = keep proportions', tags: 'shift regular perfect circle square equilateral proportional ctrl constrain aspect', body: `
    <p>Hold ${K('Shift')} (or ${K('Ctrl')}) while dragging a resize handle to scale <b>proportionally</b>: regular polygons and circles stay perfect, and every other shape — a parallelogram, a 30-60-90 triangle, a star — keeps its exact form, just bigger or smaller.</p>
    <p>When <i>drawing</i> with the Shape tool, Shift gives a perfect regular shape. To turn an existing shape regular, right-click → <b>Make regular</b>. (Prefer the old “Shift forces regular” behavior? Settings → Shapes.)</p>` },
  { title: 'Scaling by an exact value', tags: 'scale resize factor exact value number double half area perimeter width height length dilate', body: `
    <p>Select a shape and use the <b>Scale</b> row in Properties: type a factor (e.g. <code>1.5</code> or <code>sqrt(2)</code>) and press Enter, or click ½× / 2×.</p>
    <p><b>Scale…</b> (also on the right-click menu) scales to a <b>target</b> instead: a new area, perimeter, width or height (or length for lines) — the shape keeps its proportions and stays centered.</p>
    <p>The 🔗 button next to Width / Height locks them together, so typing a new width scales the height to match.</p>` },
  { title: 'Rotating shapes', tags: 'rotate rotation angle turn', body: `
    <p>Drag the round handle above the selection box. Hold ${K('Shift')} to snap to 15° steps. You can also type a rotation in the Properties panel.</p>` },
  { title: 'Setting exact side lengths', tags: 'side lengths right click dimension exact edit sides', body: `
    <p><b>Right-click</b> a polygon → <b>Set side lengths…</b>. Type the length you want for each side (AB, BC, …). The shape reshapes itself to match while staying as close as possible to how it looked.</p>
    <p>If the lengths are impossible — for example one side is longer than all the others added together — you’ll see an error and nothing changes.</p>` },
  { title: 'Setting exact angles', tags: 'angles degrees right click interior error invalid mismatch', body: `
    <p><b>Right-click</b> a polygon (not a circle) → <b>Set angles…</b>. Type each interior angle. The angles of an n-sided shape must add up to (n − 2) × 180°.</p>
    <p>When you change angles, any side length you <b>also changed</b> is kept exactly and the other sides adjust. Tick <b>Keep all side lengths exactly</b> to lock every side.</p>
    <p>If the angles and sides can’t make a valid closed shape, an <b>error</b> explains why and the shape is left unchanged.</p>` },
  { title: 'Circles & ovals: radius', tags: 'circle oval ellipse radius diameter semicircle right click', body: `
    <p><b>Right-click</b> a circle, oval or semicircle → <b>Set radius…</b>. Circles have one radius; ovals have a horizontal and vertical radius. Tick “Keep it a circle” to set both at once.</p>` },
  { title: 'Inscribed shapes', tags: 'inscribe inscribed incircle inside circle rectangle polygon nested', body: `
    <p><b>Right-click</b> a shape → <b>Inscribe</b> → choose a circle, oval, square, rectangle or any 1–20 sided polygon. The new shape is the <b>largest</b> of that kind that fits inside.</p>
    <ul><li>Circle in a polygon = the incircle (largest circle touching the sides).</li>
    <li>Polygon in a circle/oval = all corners on the curve.</li>
    <li>Same number of sides in a polygon = the midpoint polygon (e.g. the medial triangle).</li></ul>
    <p>Inscribed shapes follow their parent when it moves or changes (turn this off in Settings). Moving the inscribed shape yourself detaches it.</p>` },
  { title: 'Snap points (purple)', tags: 'snap points purple snapping magnet connect line endpoints', body: `
    <p><b>Right-click</b> a shape → <b>Snap points…</b> and choose how many. That many <b>purple points</b> are spaced evenly around the outline (default 0).</p>
    <p>When drawing a line or point near a snap point, it jumps (snaps) exactly onto it, so lines start and end precisely on the shape. Corners, centers and line endpoints also snap — each can be switched off in Settings.</p>` },
  { title: 'Grid & axes', tags: 'grid resize spacing size axes major minor toggle on off', body: `
    <p>Toggle the grid with the <b>Grid</b> button or ${K('G')}. Change the spacing with the number box next to it or in Settings, where you can also set how often major lines appear and hide the axes.</p>
    <p>Turn on <b>Snap to grid</b> in Settings to place points exactly on grid intersections.</p>` },
  { title: 'Special shapes', tags: 'special presets 30-60-90 45-45-90 golden triangle gnomon kepler pythagorean triple rectangle rhombus kite trapezoid pentagram', body: `
    <p>The <b>Special shapes</b> list has geometry classics: 30-60-90 and 45-45-90 triangles, the golden triangle (36-72-72) and golden gnomon (36-36-108), the Kepler triangle, Pythagorean triples (3-4-5, 5-12-13, 8-15-17, 7-24-25), golden and silver rectangles, rhombus, parallelogram, kite, dart, trapezoids, pentagram, hexagram and more.</p>
    <p>Hold ${K('Ctrl')} while resizing them to keep their proportions.</p>` },
  { title: 'Right-triangle tool', tags: 'right triangle pythagorean hypotenuse legs solver tool toggle', body: `
    <p>Toggle <b>Right △</b> in the top bar. Every right triangle on the canvas then shows its legs <b>a</b>, <b>b</b>, hypotenuse <b>c</b> and acute angles.</p>
    <p>The right panel also gets a <b>solver</b>: enter any two values (at least one side) and press Solve to find the rest, then Insert to draw it. Decimal places are set in Settings → Measurements.</p>` },
  { title: 'Area tool', tags: 'area perimeter tool toggle square units', body: `
    <p>Toggle <b>Area</b> in the top bar to label every shape with its area (and optionally its perimeter). Choose where the label sits, its color, and decimal places in Settings.</p>` },
  { title: 'Measure tool', tags: 'measure distance ruler angle', body: `
    <p>Press ${K('M')} or pick the ruler, then drag between two points to see the distance, Δx, Δy and angle. It snaps like the Line tool and doesn’t add anything to the graph.</p>` },
  { title: 'Polygon tool (any shape)', tags: 'polygon free custom irregular draw corners click vertices tool', body: `
    <p>Press ${K('N')} or pick the Polygon tool, then click each corner. Finish by clicking the first corner again, double-clicking, pressing ${K('Enter')} or right-clicking. ${K('Backspace')} removes the last corner, ${K('Shift')} locks sides to 15° steps.</p>
    <p>Corners snap to other shapes, so you can trace exactly over existing points and intersections.</p>` },
  { title: 'Angle tool', tags: 'angle protractor measure degrees mark reflex arc tool', body: `
    <p>Press ${K('A')} and click three points: one on the first arm, the <b>vertex</b>, then one on the second arm. A labelled angle mark stays on the graph. Drag its three handles to adjust it; right-click it to show the reflex (outside) angle or add its bisector.</p>` },
  { title: 'Intersections & smart snapping', tags: 'intersection crossing snap midpoint on outline edge magnet', body: `
    <p>While drawing, the cursor snaps to (in order of priority) purple snap points, <b>intersections</b> (orange ×), corners, centers, <b>midpoints</b> (triangle), endpoints — and when nothing else is near, to the nearest point <b>on an outline</b>. A small tag shows what you snapped to. Each kind can be switched off in Settings → Snapping.</p>` },
  { title: 'Constructions', tags: 'construction median altitude bisector centroid circumcenter incenter orthocenter euler nine-point circumcircle diagonals midpoint perpendicular parallel', body: `
    <p><b>Right-click → Constructions</b> adds classic compass-and-straightedge results:</p>
    <ul><li><b>Triangles</b>: medians + centroid G, altitudes + orthocenter H, angle bisectors + incenter I, perpendicular bisectors + circumcenter O, circumcircle, incircle, nine-point circle, Euler line.</li>
    <li><b>Any polygon</b>: diagonals, side midpoints, corner points, centroid, smallest enclosing (circumscribed) circle.</li>
    <li><b>Lines</b>: midpoint, perpendicular bisector, parallel or perpendicular line through a point you click, circle on the segment, square or equilateral triangle on the segment.</li>
    <li><b>Circles & ovals</b>: center, diameters / axes, circumscribed square or rectangle.</li></ul>
    <p>Constructions are drawn in the construction color (Settings) and selected together so you can restyle or delete them at once. They don’t follow the original if you move it later.</p>` },
  { title: 'Transformations', tags: 'transform flip mirror reflect rotate scale dilate translate move vector symmetry', body: `
    <p>Right-click a selection → <b>Transform</b>: flip horizontally or vertically, rotate 90°, rotate by any angle, scale (dilate) by a factor, move by a vector (Δx, Δy), or <b>reflect across a line</b> — then click the mirror line. Rotations and scaling use the selection’s center or the origin.</p>` },
  { title: 'Objects list: find, hide, lock & delete', tags: 'objects layers list hide show lock unlock delete trash highlight find locate visibility panel', body: `
    <p>The <b>Objects</b> panel lists everything on the graph (top-most first). <b>Click</b> a row to select the object — it <b>flashes</b> on the canvas, and the view moves to it if it’s off screen. Hovering a row highlights it too. ${K('Shift')}-click adds to the selection; right-click a row for its full menu.</p>
    <p>The <b>eye</b> hides an object, the <b>padlock</b> locks it so it can’t be moved, resized or deleted by accident, and the <b>trash can</b> deletes it (undo with ${K('Ctrl')}+${K('Z')}). All of this is adjustable in Settings → Objects Panel.</p>` },
  { title: 'Interior & exterior angles', tags: 'exterior interior angle turning extension supplementary', body: `
    <p>Settings → Measurements → <b>Which angles to show</b> switches angle labels between interior angles, exterior angles, or both. An exterior angle is measured between a side and the <b>dotted extension</b> of the previous side; for a convex polygon the exterior angles always add up to 360°.</p>` },
  { title: 'Precision placing', tags: 'alt snapping off precise nudge arrow keys exact', body: `
    <p>Hold ${K('Alt')} while drawing or dragging to turn snapping off for a moment. Use the arrow keys to nudge the selection (set the distance in Settings → Selection & Editing), or type exact values in the Properties panel.</p>` },
  { title: 'Shape type & corner coordinates', tags: 'classify classification type name scalene isosceles rhombus parallelogram trapezoid kite coordinates vertices exact', body: `
    <p>The Properties panel names the shape’s type — e.g. <i>right isosceles triangle</i>, <i>rhombus</i>, <i>isosceles trapezoid</i>, <i>regular hexagon</i> — and updates as you edit. Open <b>Corner coordinates</b> to type the exact x and y of every corner.</p>` },
  { title: 'Graphing functions', tags: 'function graph y= f(x) plot equation sin cos expression', body: `
    <p>In the <b>Functions</b> section type an expression in x, like <code>x^2 - 3</code>, <code>2sin(x)</code>, <code>sqrt(9 - x^2)</code> or <code>abs(x)/2</code>, and press Enter.</p>
    <p>Supported: + − × ÷ ^, parentheses, implicit multiplication (2x), sin cos tan asin acos atan sinh cosh tanh sqrt cbrt abs ln log log2 exp floor ceil round sign sec csc cot, and constants pi, e, tau, phi.</p>
    <p><b>Styling:</b> click a function (in the list or on the graph) to edit it in Properties — line style (solid, dashed, dotted, dash-dot), color, thickness and opacity. You can also limit it to a <b>domain</b> (e.g. from x = 0 to x = 4), add dots at the domain ends, and show a “y = …” label on the graph. Right-click a curve for quick line-style and thickness choices.</p>` },
  { title: 'Editing corners (vertex mode)', tags: 'vertex vertices corners edit drag double click points reshape', body: `
    <p><b>Double-click</b> a polygon (or right-click → Edit corners) to drag its individual corners. Corners snap to other shapes. Press ${K('Esc')} or click elsewhere to finish.</p>` },
  { title: 'Saving locally', tags: 'save open load local storage browser file new', body: `
    <p><b>Save</b> (${K('Ctrl')}+${K('S')}) stores the graph under a name in this browser. <b>Open</b> lists your saved graphs so you can load or delete them. Your current graph is also autosaved.</p>` },
  { title: 'Sharing with a code', tags: 'share code link import export send friend', body: `
    <p><b>Share</b> creates a compact code (and a link) containing your whole graph. Send it to anyone — they paste it into <b>Import</b>, or just open the link.</p>` },
  { title: 'Exporting a picture', tags: 'export png svg vector image picture download screenshot print', body: `<p><b>Export</b> → <b>PNG</b> downloads a picture of the current view (with labels). <b>SVG</b> downloads a sharp vector drawing of the shapes, lines, points, angles, text and functions — ideal for printing, worksheets or editing in Inkscape/Illustrator.</p>` },
  { title: 'Right-click menu', tags: 'context menu right click options', body: `
    <p>Right-click a <b>shape</b> for: side lengths, angles, radius, inscribe, snap points, corner editing, duplicate, order and delete. Right-click a <b>line</b> to set its length/angle. Right-click empty space to paste, add a shape there or reset the view.</p>` },
  { title: 'Keyboard shortcuts', tags: 'keyboard shortcuts hotkeys keys', body: `
    <table class="keys">
    <tr><td>${K('V')} ${K('H')} ${K('L')} ${K('P')} ${K('S')} ${K('N')} ${K('A')} ${K('T')} ${K('M')}</td><td>Select, Pan, Line, Point, Shape, Polygon, Angle, Text, Measure</td></tr>
    <tr><td>${K('Enter')} / ${K('Backspace')}</td><td>Finish polygon / remove its last corner</td></tr>
    <tr><td>${K('1')}…${K('9')}</td><td>Shape tool sides (with Shape tool active)</td></tr>
    <tr><td>${K('Ctrl')}+${K('Z')} / ${K('Ctrl')}+${K('Y')}</td><td>Undo / redo</td></tr>
    <tr><td>${K('Ctrl')}+${K('C')} / ${K('V')} / ${K('D')}</td><td>Copy / paste / duplicate</td></tr>
    <tr><td>${K('Delete')}</td><td>Delete selection</td></tr>
    <tr><td>Arrow keys</td><td>Nudge (hold Shift for bigger steps)</td></tr>
    <tr><td>${K('G')}</td><td>Toggle grid</td></tr>
    <tr><td>${K('+')} ${K('-')} ${K('0')}</td><td>Zoom in / out / reset view</td></tr>
    <tr><td>${K('Ctrl')}+${K('S')}</td><td>Save</td></tr>
    <tr><td>${K('?')} / ${K('F1')}</td><td>Help</td></tr>
    <tr><td>${K('Esc')}</td><td>Cancel / deselect</td></tr></table>` },
  { title: 'Settings', tags: 'settings preferences options configure toggle search', body: `
    <p>Open Settings with the gear. Use the search bar to find any option — snapping, labels, interior/exterior angles, decimal places, default colors, handle size, panels, theme and more. The chips at the top jump to a group. <b>Reset all</b> restores the defaults; each changed setting shows a ↺ button to reset just that one.</p>` },
  { title: 'Undo & redo', tags: 'undo redo history mistake', body: `<p>${K('Ctrl')}+${K('Z')} undoes, ${K('Ctrl')}+${K('Y')} or ${K('Ctrl')}+${K('Shift')}+${K('Z')} redoes. The top bar has buttons too.</p>` },
  { title: 'Troubleshooting', tags: 'problem bug error not working reset', body: `
    <ul><li>A value won’t apply? Look for the red error message in the dialog — it explains what is impossible.</li>
    <li>Lost? Press ${K('0')} to reset the view.</li>
    <li>Snapping too eager? Lower the snap distance in Settings.</li></ul>` },
];
