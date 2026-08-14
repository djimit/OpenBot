/**
 * JXA (JavaScript for Automation) sources that post CoreGraphics events.
 *
 * System Events can click and type but has no vocabulary for the scroll wheel
 * or for press-move-release dragging, so those two go through CoreGraphics via
 * `osascript -l JavaScript`. Still zero npm dependencies: CoreGraphics is
 * bridged by macOS itself.
 *
 * Every script defines `run(argv)` and prints `ok`. Coordinates are global
 * display points with the origin at the top-left of the primary display.
 *
 * CGEvent constants used below:
 *   event types   1 leftDown  2 leftUp  3 rightDown  4 rightUp  5 mouseMoved
 *                 6 leftDragged  25 otherDown  26 otherUp
 *   mouse buttons 0 left  1 right  2 middle
 *   field 1       kCGMouseEventClickState (1 = single, 2 = double, …)
 *   scroll units  0 = pixels; wheel1 is vertical, wheel2 horizontal
 *   event tap     0 = kCGHIDEventTap (the same place real input arrives)
 */

const PRELUDE = `ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function pause(seconds) { $.NSThread.sleepForTimeInterval(seconds); }
function point(x, y) { return { x: x, y: y }; }
`

export const MOVE_JXA = `${PRELUDE}
function run(argv) {
  var pt = point(parseFloat(argv[0]), parseFloat(argv[1]));
  var move = $.CGEventCreateMouseEvent($(), 5, pt, 0);
  if (!move) throw new Error('CGEventCreateMouseEvent unavailable');
  $.CGEventPost(0, move);
  return 'ok';
}`

export const CLICK_JXA = `${PRELUDE}
function run(argv) {
  var pt = point(parseFloat(argv[0]), parseFloat(argv[1]));
  var button = parseInt(argv[2], 10) || 0;
  var clicks = Math.max(1, Math.min(3, parseInt(argv[3], 10) || 1));
  var downType = button === 1 ? 3 : button === 2 ? 25 : 1;
  var upType = button === 1 ? 4 : button === 2 ? 26 : 2;

  var move = $.CGEventCreateMouseEvent($(), 5, pt, button);
  if (!move) throw new Error('CGEventCreateMouseEvent unavailable');
  $.CGEventPost(0, move);
  pause(0.02);

  for (var i = 1; i <= clicks; i++) {
    var down = $.CGEventCreateMouseEvent($(), downType, pt, button);
    $.CGEventSetIntegerValueField(down, 1, i);
    $.CGEventPost(0, down);
    pause(0.01);
    var up = $.CGEventCreateMouseEvent($(), upType, pt, button);
    $.CGEventSetIntegerValueField(up, 1, i);
    $.CGEventPost(0, up);
    if (i < clicks) pause(0.05);
  }
  return 'ok';
}`

export const SCROLL_JXA = `${PRELUDE}
function run(argv) {
  var pt = point(parseFloat(argv[0]), parseFloat(argv[1]));
  var dx = parseInt(argv[2], 10) || 0;
  var dy = parseInt(argv[3], 10) || 0;

  var move = $.CGEventCreateMouseEvent($(), 5, pt, 0);
  if (move) $.CGEventPost(0, move);

  var distance = Math.max(Math.abs(dx), Math.abs(dy));
  var steps = Math.max(1, Math.min(24, Math.ceil(distance / 40)));
  for (var i = 0; i < steps; i++) {
    // Wheel deltas are inverted: a positive wheel1 scrolls the view upward.
    var event = $.CGEventCreateScrollWheelEvent($(), 0, 2, Math.round(-dy / steps), Math.round(-dx / steps));
    if (!event) throw new Error('CGEventCreateScrollWheelEvent unavailable');
    $.CGEventPost(0, event);
    pause(0.012);
  }
  return 'ok';
}`

export const DRAG_JXA = `${PRELUDE}
function run(argv) {
  var from = point(parseFloat(argv[0]), parseFloat(argv[1]));
  var to = point(parseFloat(argv[2]), parseFloat(argv[3]));
  var steps = 30;

  var move = $.CGEventCreateMouseEvent($(), 5, from, 0);
  if (!move) throw new Error('CGEventCreateMouseEvent unavailable');
  $.CGEventPost(0, move);
  pause(0.05);

  var down = $.CGEventCreateMouseEvent($(), 1, from, 0);
  $.CGEventPost(0, down);
  pause(0.08);

  for (var i = 1; i <= steps; i++) {
    var t = i / steps;
    var here = point(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    var dragged = $.CGEventCreateMouseEvent($(), 6, here, 0);
    $.CGEventPost(0, dragged);
    pause(0.012);
  }

  pause(0.05);
  var up = $.CGEventCreateMouseEvent($(), 2, to, 0);
  $.CGEventPost(0, up);
  return 'ok';
}`
