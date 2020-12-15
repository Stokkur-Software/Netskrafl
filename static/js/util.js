/*

	Util.js

	Utility functions for the Explo user interface

  Copyright (C) 2020 Miðeind ehf.
  Author: Vilhjálmur Þorsteinsson

  The GNU General Public License, version 3, applies to this software.
  For further information, see https://github.com/mideind/Netskrafl

  The following code is mostly copied from
  https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures

*/

/* eslint-disable indent */
/* eslint-disable no-console */
/* eslint-disable no-unused-vars */

// Global vars to cache event state
var evCache = [];
var prevDiff = -1;

function addPinchZoom(attrs, funcZoomIn, funcZoomOut) {
  // Install event handlers for the pointer target
  attrs.onpointerdown = pointerdown_handler;
  attrs.onpointermove = pointermove_handler.bind(null, funcZoomIn, funcZoomOut);
  // Use same handler for pointer{up,cancel,out,leave} events since
  // the semantics for these events - in this app - are the same.
  attrs.onpointerup = pointerup_handler;
  attrs.onpointercancel = pointerup_handler;
  attrs.onpointerout = pointerup_handler;
  attrs.onpointerleave = pointerup_handler;
}

function pointerdown_handler(ev) {
  // The pointerdown event signals the start of a touch interaction.
  // This event is cached to support 2-finger gestures
  evCache.push(ev);
  ev.preventDefault();
}

function pointermove_handler(funcZoomIn, funcZoomOut, ev) {
  // This function implements a 2-pointer horizontal pinch/zoom gesture. 
  //
  // If the distance between the two pointers has increased (zoom in), 
  // the target element's background is changed to "pink" and if the 
  // distance is decreasing (zoom out), the color is changed to "lightblue".
  //
  // Find this event in the cache and update its record with this event
  for (var i = 0; i < evCache.length; i++) {
    if (ev.pointerId == evCache[i].pointerId) {
      evCache[i] = ev;
      break;
    }
  }
 
  // If two pointers are down, check for pinch gestures
  if (evCache.length == 2) {
    // Calculate the distance between the two pointers
    var curDiff = Math.abs(evCache[0].clientX - evCache[1].clientX);
 
    if (prevDiff > 0) {
      if (curDiff > prevDiff) {
        // The distance between the two pointers has increased
        funcZoomIn();
      }
      if (curDiff < prevDiff) {
        // The distance between the two pointers has decreased
        funcZoomOut();
      }
    }
 
    // Cache the distance for the next move event 
    prevDiff = curDiff;
  }
  ev.preventDefault();
}

function pointerup_handler(ev) {
  // Remove this pointer from the cache and reset the target's
  // background and border
  remove_event(ev);
  // If the number of pointers down is less than two then reset diff tracker
  if (evCache.length < 2) {
    prevDiff = -1;
  }
  ev.preventDefault();
}

function remove_event(ev) {
  // Remove this event from the target's cache
  for (var i = 0; i < evCache.length; i++) {
    if (evCache[i].pointerId == ev.pointerId) {
      evCache.splice(i, 1);
      break;
    }
  }
}