/*

   Netskrafl.js
   Client-side script for the Netskrafl server in netskrafl.py

   Author: Vilhjalmur Thorsteinsson, 2014

*/

/* Constants */

var ROWIDS = "ABCDEFGHIJKLMNO";
var BOARD_SIZE = 15;
var RACK_SIZE = 7;
var BAG_TILES_PER_LINE = 19;
var LEGAL_LETTERS = "aábdðeéfghiíjklmnoóprstuúvxyýþæö";

var TILESCORE = {
   'a': 1, 'á': 4, 'b': 6, 'd': 4, 'ð': 2, 'e': 1, 'é': 6, 'f': 3, 'g': 2,
   'h': 3, 'i': 1, 'í': 4, 'j': 5, 'k': 2, 'l': 2, 'm': 2, 'n': 1, 'o': 3,
   'ó': 6, 'p': 8, 'r': 1, 's': 1, 't': 1, 'u': 1, 'ú': 8, 'v': 3, 'x': 10,
   'y': 7, 'ý': 9, 'þ': 4, 'æ': 5, 'ö': 7, '?': 0
};

var WORDSCORE = new Array(
   "311111131111113",
   "121111111111121",
   "112111111111211",
   "111211111112111",
   "111121111121111",
   "111111111111111",
   "111111111111111",
   "311111121111113",
   "111111111111111",
   "111111111111111",
   "111121111121111",
   "111211111112111",
   "112111111111211",
   "121111111111121",
   "311111131111113");

var LETTERSCORE = new Array(
   "111211111112111",
   "111113111311111",
   "111111212111111",
   "211111121111112",
   "111111111111111",
   "131113111311131",
   "112111212111211",
   "111211111112111",
   "112111212111211",
   "131113111311131",
   "111111111111111",
   "211111121111112",
   "111111212111111",
   "111113111311111",
   "111211111112111");

var GAME_OVER = 16; /* Error code corresponding to the Error class in skraflmechanics.py */

/* Global variables */

var numMoves = 0;
var leftTotal = 0, rightTotal = 0; // Accumulated scores - incremented in appendMove()
var newestMove = null; // The tiles placed in the newest move (used in move review)

var entityMap = {
   "&": "&amp;",
   "<": "&lt;",
   ">": "&gt;",
   '"': '&quot;',
   "'": '&#39;',
   "/": '&#x2F;'
};

function escapeHtml(string) {
   /* Utility function to properly encode a string into HTML */
   return String(string).replace(/[&<>"'\/]/g, function (s) {
      return entityMap[s];
   });
}

function nullFunc(json) {
   /* Null placeholder function to use for Ajax queries that don't need a success func */
}

function errFunc(xhr, status, errorThrown) {
   /* Error handling function for Ajax communications */
   alert("Villa í netsamskiptum");
   console.log("Error: " + errorThrown);
   console.log("Status: " + status);
   console.dir(xhr);
}

function serverQuery(requestUrl, jsonData, successFunc) {
   /* Wraps a simple, standard Ajax request to the server */
   $.ajax({
      // The URL for the request
      url: requestUrl,

      // The data to send
      data: jsonData,

      // Whether this is a POST or GET request
      type: "POST",

      // The type of data we expect back
      dataType : "json",

      cache: false,

      // Code to run if the request succeeds;
      // the response is passed to the function
      success: (!successFunc) ? nullFunc : successFunc,

      // Code to run if the request fails; the raw request and
      // status codes are passed to the function
      error: errFunc,

      // code to run regardless of success or failure
      complete: function(xhr, status) {
      }
   });
}

function coord(row, col) {
   /* Return the co-ordinate string for the given 0-based row and col */
   return ROWIDS.charAt(row) + (col + 1).toString();
}

function toVector(co) {
   /* Convert a co-ordinate string to a 0-based row, col and direction vector */
   var dx = 0, dy = 0;
   var col = 0;
   var row = ROWIDS.indexOf(co.charAt(0));
   if (row >= 0) {
      /* Horizontal move */
      col = parseInt(co.slice(1)) - 1;
      dx = 1;
   }
   else {
      /* Vertical move */
      row = ROWIDS.indexOf(co.charAt(co.length - 1));
      col = parseInt(co) - 1;
      dy = 1;
   }
   return { col: col, row: row, dx: dx, dy: dy };
}

function tileAt(row, col) {
   /* Returns the tile element within a square, or null if none */
   if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE)
      return null;
   var el = document.getElementById(coord(row, col));
   if (!el || !el.firstChild)
      return null;
   /* Avoid a false positive here if the child DIV is the clone being dragged */
   if ($(el.firstChild).hasClass("ui-draggable-dragging"))
      return null;
   return el.firstChild;
}

function placeTile(sq, tile, letter, score) {
   /* Place a given tile in a particular square, either on the board or in the rack */
   if (tile.length === 0) {
      /* Erasing tile */
      $("#"+sq).html("");
      return;
   }
   var attr;
   if (sq.charAt(0) == "R") {
      /* Placing a tile into the rack */
      attr = "class='tile racktile'";
      letter = (tile == "?") ? "&nbsp;" : tile;
   }
   else
      /* Normal board tile */
      attr = "class='tile'";
   $("#"+sq).html("<div " + attr + ">" + letter +
      "<div class='letterscore'>" + score + "</div></div>");
   var elem = $("#"+sq).children().eq(0);
   elem.data("score", score);
   if (sq.charAt(0) == "R") {
      /* Store associated data with rack tiles */
      elem.data("tile", tile);
   }
   else
   if (tile == '?') {
      /* Blank tile used as a letter: use different foreground color */
      elem.addClass("blanktile");
   }
}

function placeMove(player, co, tiles) {
   /* Place an entire move on the board, returning a dictionary of the tiles actually added */
   var vec = toVector(co);
   var col = vec.col;
   var row = vec.row;
   var nextBlank = false;
   var placed = { };
   for (var i = 0; i < tiles.length; i++) {
      var tile = tiles.charAt(i);
      if (tile == '?') {
         nextBlank = true;
         continue;
      }
      var sq = coord(row, col);
      if (tileAt(row, col) === null) {
         /* No tile already in the square: place the new one */
         var letter = tile;
         if (nextBlank)
            tile = '?';
         var score = TILESCORE[tile];
         placeTile(sq, tile, letter, score);
         placed[sq] = { tile: tile, letter: letter, score:score };
      }
      col += vec.dx;
      row += vec.dy;
      nextBlank = false;
   }
   return placed;
}

function colorOf(player) {
   /* Return the highlight color of tiles for the given player index */
   return player == localPlayer() ? "0" : "1";
}

function highlightNewestMove(playerColor) {
   /* Show the newest move on the board in the player's color */
   if (!newestMove)
      // newestMove must be set when the board was initialized
      return;
   for (var nsq in newestMove)
      if (newestMove.hasOwnProperty(nsq)) {
         var tileDiv = $("#"+nsq).children().eq(0);
         if (tileDiv !== null)
            tileDiv.addClass("highlight" + playerColor);
      }
}

var tempTiles = null;

function showBestMove(ev) {
   /* Show a move from the best move list on the board */
   var co = ev.data.coord;
   var tiles = ev.data.tiles;
   var playerColor = ev.data.player;
   var vec = toVector(co);
   var col = vec.col;
   var row = vec.row;
   var nextBlank = false;
   var tileDiv = null;
   var nsq = null;
   if (ev.data.show) {
      /* Clear the list of temporary tiles added */
      tempTiles = { };
      /* Hide the most recent move */
      for (nsq in newestMove)
         if (newestMove.hasOwnProperty(nsq))
            placeTile(nsq, "", "", 0);
      /* Show the score difference */
      var scoreBest = parseInt($(this).find("span.score").eq(0).text());
      var scoreMove = parseInt($("div.score").eq(0).text());
      var scoreDiff = (scoreMove - scoreBest).toString();
      if (scoreMove > scoreBest) {
         scoreDiff = "+" + scoreDiff;
      }
      $("div.scorediff").text(scoreDiff);
      $("div.scorediff").toggleClass("posdiff", scoreMove >= scoreBest);
      $("div.scorediff").css("visibility", "visible");
   }
   for (var i = 0; i < tiles.length; i++) {
      var tile = tiles.charAt(i);
      if (tile == '?') {
         nextBlank = true;
         continue;
      }
      var sq = coord(row, col);
      var letter = tile;
      if (nextBlank)
         tile = '?';
      tileDiv = tileAt(row, col);
      if (tileDiv === null && ev.data.show) {
         /* No tile in the square: add it temporarily & highlight it */
         placeTile(sq, tile, letter, TILESCORE[tile]);
         tempTiles[sq] = true;
         tileDiv = tileAt(row, col);
         $(tileDiv).addClass("highlight" + playerColor);
      }
      else
      if (tileDiv !== null && !ev.data.show && tempTiles[sq])
         /* This tile was added temporarily: remove it */
         placeTile(sq, "", "", 0);
      col += vec.dx;
      row += vec.dy;
      nextBlank = false;
   }
   if (ev.data.show)
      /* Add a highlight to the score */
      $(this).find("span.score").addClass("highlight");
   else {
      /* Remove highlight from score */
      $(this).find("span.score").removeClass("highlight");
      tempTiles = null;
      /* Show and highlight the most recent move again */
      for (nsq in newestMove)
         if (newestMove.hasOwnProperty(nsq))
            placeTile(nsq, newestMove[nsq].tile, newestMove[nsq].letter, newestMove[nsq].score);
      highlightNewestMove(playerColor);
      /* Hide the score difference */
      $("div.scorediff").css("visibility", "hidden");
   }
}

function highlightMove(ev) {
   /* Highlight a move's tiles when hovering over it in the move list */
   var co = ev.data.coord;
   var tiles = ev.data.tiles;
   var playerColor = ev.data.player;
   var vec = toVector(co);
   var col = vec.col;
   var row = vec.row;
   for (var i = 0; i < tiles.length; i++) {
      var tile = tiles.charAt(i);
      if (tile == '?')
         continue;
      var sq = coord(row, col);
      var tileDiv = $("#"+sq).children().eq(0);
      if (ev.data.show)
         tileDiv.addClass("highlight" + playerColor);
      else
         tileDiv.removeClass("highlight" + playerColor);
      col += vec.dx;
      row += vec.dy;
   }
   if (ev.data.show)
      /* Add a highlight to the score */
      $(this).find("span.score").addClass("highlight");
   else
      /* Remove highlight from score */
      $(this).find("span.score").removeClass("highlight");
}

function appendMove(player, co, tiles, score) {
   /* Add a move to the move history list */
   var wrdclass = "wordmove";
   var rawCoord = co;
   if (co === "") {
      /* Not a regular tile move */
      wrdclass = "othermove";
      if (tiles == "PASS")
         /* Pass move */
         tiles = "Pass";
      else
      if (tiles.indexOf("EXCH") === 0) {
         /* Exchange move - we don't show the actual tiles exchanged, only their count */
         var numtiles = tiles.slice(5).length;
         tiles = "Skipti um " + numtiles.toString() + (numtiles == 1 ? " staf" : " stafi");
      }
      else
      if (tiles == "RSGN")
         /* Resigned from game */
         tiles = "Gaf leikinn";
      else
      if (tiles == "OVER") {
         /* Game over */
         tiles = "Leik lokið";
         wrdclass = "gameover";
      }
      else
         /* The rack leave at the end of the game (which is always in lowercase
            and thus cannot be confused with the above abbreviations) */
         wrdclass = "wordmove";
   }
   else {
      co = "(" + co + ")";
      // Note: String.replace() will not work here since there may be two question marks in the string
      tiles = tiles.split("?").join(""); /* !!! TODO: Display wildcard characters differently? */
   }
   var str;
   if (wrdclass == "gameover") {
      str = '<div class="gameover"><span class="gameovermsg">' + tiles + '</span>' +
         '<span class="statsbutton" onclick="navToReview()">Skoða yfirlit</span></div>';
   }
   else
   if (player === 0) {
      /* Left side player */
      str = '<div class="leftmove">' +
         '<span class="total">' + (leftTotal + score) + '</span>' +
         '<span class="score">' + score + '</span>' +
         '<span class="' + wrdclass + '"><i>' + tiles + '</i> ' +
         co + '</span>' +
         '</div>';
   }
   else {
      /* Right side player */
      str = '<div class="rightmove">' +
         '<span class="' + wrdclass + '">' + co +
         ' <i>' + tiles + '</i></span>' +
         '<span class="score">' + score + '</span>' + 
         '<span class="total">' + (rightTotal + score) + '</span>' +
         '</div>';
   }
   var movelist = $("div.movelist");
   movelist.append(str);
   if (wrdclass != "gameover") {
      var m = movelist.children().last();
      var playerColor = "0";
      if (player === localPlayer())
         m.addClass("humangrad" + (player === 0 ? "_left" : "_right")); /* Local player */
      else {
         m.addClass("autoplayergrad" + (player === 0 ? "_left" : "_right")); /* Remote player */
         playerColor = "1";
      }
      if (wrdclass == "wordmove") {
         /* Register a hover event handler to highlight this move */
         m.on("mouseover",
            { coord: rawCoord, tiles: tiles, score: score, player: playerColor, show: true },
            highlightMove
         );
         m.on("mouseout",
            { coord: rawCoord, tiles: tiles, score: score, player: playerColor, show: false },
            highlightMove
         );
      }
   }
   /* Manage the scrolling of the move list */
   var lastchild = $("div.movelist:last-child"); /* .children().last() causes problems */
   var firstchild = movelist.children().eq(0);
   var topoffset = lastchild.position().top -
      firstchild.position().top +
      lastchild.height();
   var height = movelist.height();
   if (topoffset >= height)
      movelist.scrollTop(topoffset - height);
   /* Count the moves */
   numMoves += 1;
   /* Update the scores */
   if (player === 0)
      leftTotal += score;
   else
      rightTotal += score;
}

function appendBestMove(player, co, tiles, score) {
   /* Add a move to the best move list */
   var rawCoord = co;
   var rawTiles = tiles;
   var str;
   co = "(" + co + ")";
   // Note: String.replace will not work here since string may contain multiple '?' instances
   tiles = tiles.split("?").join(""); /* !!! TODO: Display wildcard characters differently? */
   if (player === 0) {
      /* Left side player */
      str = '<div class="leftmove">' +
         '<span class="score">' + score + '</span>' +
         '<span class="wordmove"><i>' + tiles + '</i> ' +
         co + '</span>' +
         '</div>';
   }
   else {
      /* Right side player */
      str = '<div class="rightmove">' +
         '<span class="wordmove">' + co +
         ' <i>' + tiles + '</i></span>' +
         '<span class="score">' + score + '</span>' + 
         '</div>';
   }
   var movelist = $("div.movelist");
   movelist.append(str);
   var m = movelist.children().last();
   var playerColor = "0";
   if (player === localPlayer())
      m.addClass("humangrad" + (player === 0 ? "_left" : "_right")); /* Local player */
   else {
      m.addClass("autoplayergrad" + (player === 0 ? "_left" : "_right")); /* Remote player */
      playerColor = "1";
   }
   /* Register a hover event handler to highlight this move */
   m.on("mouseover",
      { coord: rawCoord, tiles: rawTiles, score: score, player: playerColor, show: true },
      showBestMove
   );
   m.on("mouseout",
      { coord: rawCoord, tiles: rawTiles, score: score, player: playerColor, show: false },
      showBestMove
   );
}

function appendBestHeader(moveNumber, co, tiles, score) {
   /* Add a header on the best move list */
   var wrdclass = "wordmove";
   var dispText;
   if (co.length > 0) {
      // Regular move
      co = " (" + co + ")";
      dispText = "<i>" + tiles.split("?").join("") + "</i>"; /* !!! TODO: Display wildcard characters differently? */
   }
   else {
      /* Not a regular tile move */
      wrdclass = "othermove";
      if (tiles == "PASS")
         /* Pass move */
         dispText = "Pass";
      else
      if (tiles.indexOf("EXCH") === 0) {
         /* Exchange move - we don't show the actual tiles exchanged, only their count */
         var numtiles = tiles.slice(5).length;
         dispText = "Skipti um " + numtiles.toString() + (numtiles == 1 ? " staf" : " stafi");
      }
      else
      if (tiles == "RSGN")
         /* Resigned from game */
         dispText = "Gaf leikinn";
      else
      if (tiles == "OVER") {
         /* Game over */
         dispText = "Leik lokið";
         wrdclass = "gameover";
      }
      else {
         /* The rack leave at the end of the game (which is always in lowercase
            and thus cannot be confused with the above abbreviations) */
         wrdclass = "wordmove";
         dispText = tiles;
      }
   }
   var str = '<div class="reviewhdr">' +
      '<span class="movenumber">#' + moveNumber.toString() + '</span>' +
      '<span class="' + wrdclass + '">' + dispText + co + '</span>' +
      // '<span class="score">' + score + '</span>' +
      '</div>';
   $("div.movelist").append(str);
}

function promptForBlank() {
   /* When dropping a blank tile, ask for its meaning */
   var defq = "Hvaða staf táknar auða flísin?";
   var err = "\nSláðu inn einn staf í íslenska stafrófinu.";
   var q = defq;
   while(true) {
      var letter = prompt(q);
      if (letter === null)
         /* Pressed Esc or terminated */
         return null;
      if (letter.length != 1) {
         q = defq + err;
         continue;
      }
      letter = letter.toLowerCase();
      if (LEGAL_LETTERS.indexOf(letter) == -1) {
         /* Not an allowed letter: add an error message and prompt again */
         q = defq + err;
         continue;
      }
      return letter;
   }
}

var elementDragged = null; /* The element being dragged with the mouse */
var showingDialog = false; /* Is a modal dialog banner being shown? */
var exchangeAllowed = true; /* Is an exchange move allowed? */

function handleDragstart(e, ui) {
   /* The dragstart target is the DIV inside a TD */
   elementDragged = e.target;
   elementDragged.style.opacity = "0.5";
}

function handleDragend(e, ui) {
   if (elementDragged !== null)
      elementDragged.style.opacity = "1.0";
   elementDragged = null;
}

function handleDropover(e, ui) {
   if (e.target.id.charAt(0) == 'R' || e.target.firstChild === null)
     /* Rack square or empty square: can drop. Add yellow outline highlight to square */
     this.classList.add("over");
}

function handleDropleave(e, ui) {
   /* Can drop here: remove outline highlight from square */
   this.classList.remove("over");
}

function initDraggable(elem) {
   /* The DIVs inside the board TDs are draggable */
   $(elem).draggable(
      {
         opacity : 0.8,
         helper : "clone",
         cursor : "pointer",
         zIndex : 100,
         start : handleDragstart,
         stop : handleDragend
      }
   );
}

function removeDraggable(elem) {
   /* The DIVs inside the board TDs are draggable */
   $(elem).draggable("destroy");
}

function initRackDraggable(state) {
   /* Make the seven tiles in the rack draggable or not, depending on
      the state parameter */
   for (var i = 1; i <= RACK_SIZE; i++) {
      var rackTileId = "R" + i.toString();
      var rackTile = document.getElementById(rackTileId);
      if (rackTile && rackTile.firstChild)
         /* There is a tile in this rack slot */
         if (state)
            initDraggable(rackTile.firstChild);
         else
            removeDraggable(rackTile.firstChild);
   }
}

function initDropTarget(elem) {
   /* Prepare a board square or a rack slot to accept drops */
   if (elem !== null)
      elem.droppable(
         {
            drop : handleDrop,
            over : handleDropover,
            out : handleDropleave
         }
      );
}

function initDropTargets() {
   /* All board squares are drop targets */
   var x, y, sq;
   for (x = 0; x < BOARD_SIZE; x++)
      for (y = 0; y < BOARD_SIZE; y++) {
         sq = $("#" + coord(y, x));
         initDropTarget(sq);
      }
   /* Make the rack a drop target as well */
   for (x = 1; x <= RACK_SIZE; x++) {
      sq = $("#R" + x.toString());
      initDropTarget(sq);
   }
}

function handleDrop(e, ui) {
   /* A tile is being dropped on a square on the board or into the rack */
   e.target.classList.remove("over");
   /* Save the elementDragged value as it will be set to null in handleDragend() */
   var eld = elementDragged;
   if (eld === null)
      return;
   eld.style.opacity = "1.0";
   var dropToRack = (e.target.id.charAt(0) == 'R');
   if (dropToRack && e.target.firstChild !== null) {
      /* Dropping into an already occupied rack slot: shuffle the rack tiles to make room */
      var ix = parseInt(e.target.id.slice(1));
      var rslot = null;
      var i = 0;
      /* Try to find an empty slot to the right */
      for (i = ix + 1; i <= RACK_SIZE; i++) {
         rslot = document.getElementById("R" + i.toString());
         if (!rslot.firstChild)
            /* Empty slot in the rack */
            break;
         rslot = null;
      }
      if (rslot === null) {
         /* Not found: Try an empty slot to the left */
         for (i = ix - 1; i >= 1; i--) {
            rslot = document.getElementById("R" + i.toString());
            if (!rslot.firstChild)
               /* Empty slot in the rack */
               break;
            rslot = null;
         }
      }
      if (rslot === null) {
         /* No empty slot: must be internal shuffle in the rack */
         rslot = eld.parentNode;
         i = parseInt(rslot.id.slice(1));
      }
      if (rslot !== null) {
         var j, src, tile;
         if (i > ix)
            /* Found empty slot: shift rack tiles to the right to make room */
            for (j = i; j > ix; j--) {
               src = document.getElementById("R" + (j - 1).toString());
               tile = src.firstChild;
               src.removeChild(tile);
               rslot.appendChild(tile);
               rslot = src;
            }
         else
         if (i < ix)
            /* Found empty slot: shift rack tiles to the left to make room */
            for (j = i; j < ix; j++) {
               src = document.getElementById("R" + (j + 1).toString());
               tile = src.firstChild;
               src.removeChild(tile);
               rslot.appendChild(tile);
               rslot = src;
            }
      }
   }
   if (e.target.firstChild === null) {
      /* Looks like a legitimate drop */
      var ok = true;
      var parentid = eld.parentNode.id;
      if (parentid.charAt(0) == 'R') {
         /* Dropping from the rack */
         var t = $(eld).data("tile");
         if (!dropToRack && t == '?') {
            /* Dropping a blank tile on to the board: we need to ask for its meaning */
            e.target.classList.add("over");
            eld.style.opacity = "0.8";
            var letter = promptForBlank();
            eld.style.opacity = "1.0";
            e.target.classList.remove("over");
            if (letter === null)
               ok = false;
            else {
               $(eld).data("letter", letter);
               $(eld).addClass("blanktile");
               eld.childNodes[0].nodeValue = letter;
            }
         }
      }
      if (ok) {
         /* Complete the drop */
         eld.parentNode.removeChild(eld);
         e.target.appendChild(eld);
         if (e.target.id.charAt(0) == 'R') {
            /* Dropping into the rack */
            if ($(eld).data("tile") == '?') {
               /* Dropping a blank tile: erase its letter value, if any */
               $(eld).data("letter", ' ');
               eld.childNodes[0].nodeValue = "\xa0"; // Non-breaking space, i.e. &nbsp;
            }
         }
      }
      updateButtonState();
   }
   elementDragged = null;
}

/* The word that is being checked for validity with a server query */
var wordToCheck = "";

function wordGoodOrBad(flagGood, flagBad) {
   /* Flag whether the word being laid down is good or bad (or neither when we don't know) */
   $("div.word-check").toggleClass("word-good", flagGood);
   $("div.word-check").toggleClass("word-bad", flagBad);
}

function showWordCheck(json) {
   /* The server has returned our word check result: show it */
   if (json && json.word == wordToCheck)
      /* Nothing significant has changed since we sent the request */
      wordGoodOrBad(json.ok, !json.ok);
}

function updateButtonState() {
   /* Refresh state of action buttons depending on availability */
   var tilesPlaced = findCovers().length;
   $("div.submitmove").toggleClass("disabled",
      (tilesPlaced === 0 || showingDialog));
   $("div.submitexchange").toggleClass("disabled",
      (tilesPlaced !== 0 || showingDialog || !exchangeAllowed));
   $("div.submitpass").toggleClass("disabled",
      (tilesPlaced !== 0 || showingDialog));
   $("div.submitresign").toggleClass("disabled",
      showingDialog);
   /* Erase previous error message, if any */
   $("div.error").css("visibility", "hidden");
   /* Calculate tentative score */
   if (tilesPlaced === 0) {
      $("div.score").text("");
      wordToCheck = "";
      wordGoodOrBad(false, false);
      $("div.recallbtn").css("visibility", "hidden");
   }
   else {
      var scoreResult = calcScore();
      if (scoreResult === undefined) {
         $("div.score").text("?");
         wordToCheck = "";
         wordGoodOrBad(false, false);
      }
      else {
         $("div.score").text(scoreResult.score.toString());
         /* Start a word check request to the server, checking the
            word laid down and all cross words */
         wordToCheck = scoreResult.word;
         wordGoodOrBad(false, false);
         serverQuery("/wordcheck", { word: wordToCheck, words: scoreResult.words }, showWordCheck);
      }
      $("div.recallbtn").css("visibility", "visible");
   }
}

function buttonOver(elem) {
   /* Show a hover effect on a button */
   if (!$(elem).hasClass("disabled"))
      $(elem).toggleClass("over", true);
}

function buttonOut(elem) {
   /* Hide a hover effect on a button */
   $(elem).toggleClass("over", false);
}

function findCovers() {
   /* Return a list of the newly laid tiles on the board */
   var moves = [];
   $("div.tile").each(function() {
      var sq = $(this).parent().attr("id");
      var t = $(this).data("tile");
      if (t !== null && t !== undefined && sq.charAt(0) != "R") {
         if (t == '?')
            /* Blank tile: add its meaning */
            t += $(this).data("letter");
         moves.push(sq + "=" + t);
      }
   });
   return moves;      
}

function wordScore(row, col) {
   return parseInt(WORDSCORE[row].charAt(col));
}

function letterScore(row, col) {
   return parseInt(LETTERSCORE[row].charAt(col));
}

function calcScore() {
   /* Calculate the score for the tiles that have been laid on the board in the current move */
   var score = 0, crossScore = 0;
   var wsc = 1;
   var minrow = BOARD_SIZE, mincol = BOARD_SIZE;
   var maxrow = 0, maxcol = 0;
   var numtiles = 0, numcrosses = 0;
   var word = "";
   var words = [];
   $("div.tile").each(function() {
      var sq = $(this).parent().attr("id");
      var t = $(this).data("tile");
      if (t !== null && t !== undefined && sq.charAt(0) != "R") {
         /* Tile on the board */
         var row = ROWIDS.indexOf(sq.charAt(0));
         var col = parseInt(sq.slice(1)) - 1;
         var sc = $(this).data("score") * letterScore(row, col);
         numtiles++;
         wsc *= wordScore(row, col);
         if (row < minrow)
            minrow = row;
         if (col < mincol)
            mincol = col;
         if (row > maxrow)
            maxrow = row;
         if (col > maxcol)
            maxcol = col;
         score += sc;
      }
   });
   if (minrow != maxrow && mincol != maxcol)
      /* Not a pure horizontal or vertical move */
      return undefined;
   var x = mincol, y = minrow;
   var dx = 0, dy = 0;
   if (minrow != maxrow)
      dy = 1; /* Vertical */
   else
   if (mincol == maxcol && (tileAt(minrow - 1, mincol) !== null || tileAt(minrow + 1, mincol) !== null))
      /* Single tile: if it has tiles above or below, consider this a vertical move */
      dy = 1;
   else
      dx = 1; /* Horizontal */
   /* Find the beginning of the word */
   while (tileAt(y - dy, x - dx) !== null) {
      x -= dx;
      y -= dy;
   }
   var t = null;
   /* Find the end of the word */
   while ((t = tileAt(y, x)) !== null) {
      if ($(t).hasClass("racktile")) {
         // Add score for cross words
         var csc = calcCrossScore(y, x, 1 - dy, 1 - dx);
         if (csc.score >= 0) {
            /* There was a cross word there (it can score 0 if blank) */
            crossScore += csc.score;
            numcrosses++;
            words.push(csc.word);
         }
      }
      else {
         /* This is a tile that was previously on the board */
         score += $(t).data("score");
         numcrosses++;
      }
      /* Accumulate the word being formed */
      word += t.childNodes[0].nodeValue;
      x += dx;
      y += dy;
   }
   if (numMoves === 0) {
      // First move must go through center square
      if (null === tileAt(7, 7))
         return undefined;
   }
   else
   if (!numcrosses)
      // Not first move, and not linked with any word on the board
      return undefined;
   /* Check whether word is consecutive
      (which it is not if there is an empty square before the last tile) */
   if (dx && (x <= maxcol))
      return undefined;
   if (dy && (y <= maxrow))
      return undefined;
   words.push(word);
   return { word: word, words: words,
      score: score * wsc + crossScore + (numtiles == RACK_SIZE ? 50 : 0) };
}

function calcCrossScore(oy, ox, dy, dx) {
   /* Calculate the score contribution of a cross word */
   var score = 0;
   var hascross = false;
   var x = ox, y = oy;
   var word = "";
   /* Find the beginning of the word */
   while (tileAt(y - dy, x - dx) !== null) {
      x -= dx;
      y -= dy;
   }
   var t = null;
   /* Find the end of the word */
   while ((t = tileAt(y, x)) !== null) {
      var sc = $(t).data("score");
      if (x == ox && y == oy)
         sc *= letterScore(y, x);
      else
         hascross = true;
      word += t.childNodes[0].nodeValue;
      score += sc;
      x += dx;
      y += dy;
   }
   if (!hascross)
      return { score: -1, word: "" };
   return { score: score * wordScore(oy, ox), word: word };
}

function resetRack(ev) {
   /* Reset the rack, i.e. recall all tiles. Bound to the Esc key. */
   if (showingDialog)
      return false;
   var rslot = 1;
   $("div.tile").each(function() {
      var sq = $(this).parent().attr("id");
      var t = $(this).data("tile");
      var score = $(this).data("score");
      if (t !== null && t !== undefined && sq.charAt(0) != "R") {
         placeTile(sq, "", "", 0);
         /* Find an empty slot in the rack for the tile */
         for (; rslot <= RACK_SIZE; rslot++) {
            var rackTileId = "R" + rslot.toString();
            var rackTile = document.getElementById(rackTileId);
            if (rackTile && rackTile.firstChild === null) {
               /* Found empty rack slot: put this there */
               placeTile(rackTileId, t, t, score);
               initDraggable(rackTile.firstChild);
               rslot++;
               break;
            }
         }
      }
   });
   updateButtonState();
}

function rescrambleRack(ev) {
   /* Reorder the rack randomly. Bound to the Backspace key. */
   if (showingDialog)
      return false;

   resetRack(ev);
   var array = [];
   var i, rackTileId;
   for (i = 1; i <= RACK_SIZE; i++) {
      rackTileId = "R" + i.toString();
      array.push(document.getElementById(rackTileId).firstChild);
   }
   var currentIndex = array.length, temporaryValue, randomIndex;
   // Fisher-Yates (Knuth) shuffle algorithm
   while (0 !== currentIndex) {
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex -= 1;
      temporaryValue = array[currentIndex];
      array[currentIndex] = array[randomIndex];
      array[randomIndex] = temporaryValue;
   }
   for (i = 1; i <= RACK_SIZE; i++) {
      rackTileId = "R" + i.toString();
      var elem = document.getElementById(rackTileId);
      if (elem.firstChild !== null)
         elem.removeChild(elem.firstChild);
      if (array[i-1] !== null)
         elem.appendChild(array[i-1]);
   }
   return false; // Stop default behavior
}

function updateBag(bag) {
   /* Update the bag display in the lower right corner */
   $("#bag").html("");
   var lenbag = bag.length;
   var ix = 0;
   while (lenbag > 0) {
      /* Rows */
      var str = "<tr>";
      /* Columns: max BAG_TILES_PER_LINE tiles per row */
      for (var i = 0; i < BAG_TILES_PER_LINE && lenbag > 0; i++) {
         var tile = bag[ix++];
         if (tile == "?")
            /* Show wildcard tiles '?' as blanks */
            tile = "&nbsp;";
         str += "<td>" + tile + "</td>";
         lenbag--;
      }
      str += "</tr>";
      $("#bag").append(str);
   }
}

function updateState(json) {
   /* Work through the returned JSON object to update the
      board, the rack, the scores and the move history */
   if (json.result === 0 || json.result == GAME_OVER) {
      /* Successful move */
      /* Reinitialize the rack */
      var i = 0;
      if (json.result === 0)
         for (i = 0; i < json.rack.length; i++)
            placeTile("R" + (i + 1).toString(), /* Coordinate */
               json.rack[i][0], /* Tile */
               json.rack[i][0], /* Letter */
               json.rack[i][1]); /* Score */
      /* Clear the rest of the rack */
      for (; i < RACK_SIZE; i++)
         placeTile("R" + (i + 1).toString(), "", "", 0);
      if (json.result === 0)
         initRackDraggable(true);
      /* Glue the laid-down tiles to the board */
      $("div.tile").each(function() {
         var sq = $(this).parent().attr("id");
         var t = $(this).data("tile");
         var score = $(this).data("score");
         if (t !== null && t !== undefined && sq.charAt(0) != "R") {
            var letter = t;
            if (letter == '?') {
               /* Blank tile: get its meaning */
               letter = $(this).data("letter");
               if (letter === null || letter === undefined)
                  letter = t;
            }
            placeTile(sq, t, letter, score);
         }
      });
      /* Add the new tiles laid down in response */
      if (json.lastmove !== undefined) {
         /* Remove highlight from previous move, if any */
         $("div.highlight1").removeClass("highlight1");
         for (i = 0; i < json.lastmove.length; i++) {
            var sq = json.lastmove[i][0];
            placeTile(sq, /* Coordinate */
               json.lastmove[i][1], /* Tile */
               json.lastmove[i][2], /* Letter */
               json.lastmove[i][3]); /* Score */
            $("#"+sq).children().eq(0).addClass("freshtile");
         }
      }
      /* Update the scores */
      $(".scoreleft").text(json.scores[0]);
      $(".scoreright").text(json.scores[1]);
      /* Update the move list */
      if (json.newmoves !== undefined) {
         for (i = 0; i < json.newmoves.length; i++) {
            var player = json.newmoves[i][0];
            var co = json.newmoves[i][1][0];
            var tiles = json.newmoves[i][1][1];
            var score = json.newmoves[i][1][2];
            appendMove(player, co, tiles, score);
         }
      }
      /* Update the bag */
      if (json.bag !== undefined)
         updateBag(json.bag);
      /* See if an exchange move is still allowed */
      if (json.xchg !== undefined)
         exchangeAllowed = json.xchg;
      /* Enable and disable buttons as required */
      updateButtonState();
      if (json.result == GAME_OVER) {
         /* Game over: disable Pass, Exchange and Resign buttons */
         $("div.submitpass").toggleClass("disabled", true);
         $("div.submitresign").toggleClass("disabled", true);
         $("div.submitexchange").toggleClass("disabled", true);
         /* Hide Move button and display New Game button */
         $("div.submitmove").css("display", "none");
         $("div.submitnewgame").css("display", "inline");
      }
   }
   else {
      /* Genuine error: display in error bar */
      $("div.error").css("visibility", "visible").find("p").css("display", "none");
      var errorP = $("div.error").find("#err_" + json.result.toString());
      errorP.css("display", "inline");
      if (json.msg !== undefined)
         // Fill in word if provided in error message
         errorP.find("span.errword").text(json.msg);
   }
}

function submitMove(btn) {
   /* The Move button has been clicked: send a regular move to the backend */
   if (!$(btn).hasClass("disabled"))
      sendMove('move');
}

function submitPass(btn) {
   /* The Pass button has been pressed: submit a Pass move */
   if (!$(btn).hasClass("disabled"))
      sendMove('pass');
}

function confirmExchange(yes) {
   /* The user has either confirmed or cancelled the exchange */
   $("div.exchange").css("visibility", "hidden");
   showingDialog = false;
   updateButtonState();
   /* Take the rack out of exchange mode */
   var exch = "";
   for (var i = 1; i <= RACK_SIZE; i++) {
      var rackTileId = "#R" + i.toString();
      var rackTile = $(rackTileId).children().eq(0);
      if (rackTile) {
         /* There is a tile in this rack slot */
         if (rackTile.hasClass("xchgsel")) {
            exch += rackTile.data("tile");
            rackTile.removeClass("xchgsel");
         }
         /* Stop listening to clicks */
         rackTile.removeClass("xchg").off("click.xchg");
      }
   }
   initRackDraggable(true);
   if (yes) {
      sendMove('exch=' + exch);
   }
}

function toggleExchange(e) {
   /* Toggles the exchange state of a tile */
   $(this).toggleClass("xchgsel");
}

function submitExchange(btn) {
   /* The user has clicked the exchange button: show exchange banner */
   if (!$(btn).hasClass("disabled")) {
      $("div.exchange").css("visibility", "visible");
      showingDialog = true;
      updateButtonState();
      initRackDraggable(false);
      /* Disable all other actions while panel is shown */
      /* Put the rack in exchange mode */
      for (var i = 1; i <= RACK_SIZE; i++) {
         var rackTileId = "#R" + i.toString();
         var rackTile = $(rackTileId).children().eq(0);
         if (rackTile)
            /* There is a tile in this rack slot: mark it as
               exchangeable and attack a click handler to it */
            rackTile.addClass("xchg").on("click.xchg", toggleExchange);
      }
   }
}

function confirmResign(yes) {
   /* The user has either confirmed or cancelled the resignation */
   $("div.resign").css("visibility", "hidden");
   showingDialog = false;
   initRackDraggable(true);
   updateButtonState();
   if (yes)
      sendMove('rsgn');
}

function submitResign(btn) {
   /* The user has clicked the resign button: show resignation banner */
   if (!$(btn).hasClass("disabled")) {
      $("div.resign").css("visibility", "visible");
      showingDialog = true;
      initRackDraggable(false);
      /* Disable all other actions while panel is shown */
      updateButtonState();
   }
}

function setStat(name, json, digits, value) {
   var txt = value;
   if (txt === undefined)
      txt = json[name];
   if (txt === undefined)
      return;
   if (digits !== undefined && digits > 0)
      txt = txt.toFixed(digits).replace(".", ","); // Convert decimal point to comma
   $("#" + name).text(txt);
}

function updateStats(json) {
   /* Display statistics from a server query result encoded in JSON */
   if (!json || json.result === undefined)
      return;
   if (json.result !== 0 && json.result != GAME_OVER)
      /* Probably out of sync or login required */
      /* !!! TBD: Add error reporting here */
      return;
   setStat("gamestart", json);
   /* Statistics for player 0 (left player) */
   setStat("moves0", json);
   setStat("bingoes0", json);
   setStat("tiles0", json);
   setStat("blanks0", json);
   setStat("letterscore0", json);
   setStat("average0", json, 2);
   setStat("multiple0", json, 2);
   setStat("cleantotal0", json);
   setStat("remaining0", json);
   setStat("bingopoints0", json, 0, json.bingoes0 * 50);
   setStat("avgmove0", json, 2);
   setStat("total0", json, 0, json.scores[0]);
   setStat("ratio0", json, 1);
   /* Statistics for player 1 (right player) */
   setStat("moves1", json);
   setStat("bingoes1", json);
   setStat("tiles1", json);
   setStat("blanks1", json);
   setStat("letterscore1", json);
   setStat("average1", json, 2);
   setStat("multiple1", json, 2);
   setStat("cleantotal1", json);
   setStat("remaining1", json);
   setStat("bingopoints1", json, 0, json.bingoes1 * 50);
   setStat("avgmove1", json, 2);
   setStat("total1", json, 0, json.scores[1]);
   setStat("ratio1", json, 1);
}

function showStats(gameId) {
   $("div.gamestats").css("visibility", "visible");
   /* Get the statistics from the server */
   $.ajax({
      // the URL for the request
      url: "/gamestats",

      // the data to send
      data: {
         // Identify the game in question
         game: gameId
      },

      // whether this is a POST or GET request
      type: "POST",

      // the type of data we expect back
      dataType : "json",

      cache: false,

      // code to run if the request succeeds;
      // the response is passed to the function
      success: updateStats,

      // code to run if the request fails; the raw request and
      // status codes are passed to the function
      error: errFunc,

      // code to run regardless of success or failure
      complete: function(xhr, status) {
      }
   });
}

function hideStats() {
   $("div.gamestats").css("visibility", "hidden");
}

var submitTemp = "";

function sendMove(movetype) {
   /* Send a move to the back-end server using Ajax */
   if (submitTemp.length > 0)
      /* Avoid re-entrancy: if submitTemp contains text, we are already
         processing a previous Ajax call */
      return;
   var moves = [];
   if (movetype === null || movetype == 'move') {
      moves = findCovers();
   }
   else
   if (movetype == 'pass') {
      /* Remove any tiles that have already been placed on the board */
      $("div.tile").each(function() {
         var sq = $(this).parent().attr("id");
         var t = $(this).data("tile");
         if (t !== null && t !== undefined && sq.charAt(0) != "R") {
            placeTile(sq, "", "", 0);
         }
      });
      moves.push("pass");
   }
   else
   if (movetype.indexOf('exch=') === 0) {
      /* Exchange move */
      moves.push(movetype);
   }
   else
   if (movetype == 'rsgn') {
      /* Resigning from game */
      moves.push("rsgn");
   }
   if (moves.length === 0)
      return;
   /* Erase previous error message, if any */
   $("div.error").css("visibility", "hidden");
   /* Freshly laid tiles are no longer fresh */
   $("div.freshtile").removeClass("freshtile");
   /* Show a temporary animated GIF while the Ajax call is being processed */
   submitTemp = $("div.submitmove").html();
   $("div.submitmove").removeClass("disabled").removeClass("over");
   $("div.submitmove").html("<img src='/static/ajax-loader.gif' border=0/>");
   /* Talk to the game server using jQuery/Ajax */
   $.ajax({
      // the URL for the request
      url: "/submitmove",

      // the data to send
      data: {
         moves: moves,
         // Send a move count to ensure that the client and the server are in sync
         mcount: numMoves,
         // Send the game's UUID
         uuid: gameId()
      },

      // whether this is a POST or GET request
      type: "POST",

      // the type of data we expect back
      dataType : "json",

      cache: false,

      // code to run if the request succeeds;
      // the response is passed to the function
      success: updateState,

      // code to run if the request fails; the raw request and
      // status codes are passed to the function
      error: errFunc,

      // code to run regardless of success or failure
      complete: function(xhr, status) {
         $("div.submitmove").html(submitTemp);
         submitTemp = "";
      }
   });
}

function initSkrafl(jQuery) {
   /* Called when the page is displayed or refreshed */
   placeTiles();
   initRackDraggable(true);
   initDropTargets();
   initMoveList();
   initBag();
   if (localPlayer() === 0) {
      $("h3.playerleft").addClass("humancolor");
      $("h3.playerright").addClass("autoplayercolor");
   }
   else {
      $("h3.playerright").addClass("humancolor");
      $("h3.playerleft").addClass("autoplayercolor");
   }
   updateButtonState();
   /* Bind Esc key to a function to reset the rack */
   Mousetrap.bind('esc', resetRack);
   /* Bind Backspace key to a function to rescramble the rack */
   Mousetrap.bind('backspace', rescrambleRack);
   /* Bind pinch gesture to a function to reset the rack */
   /* $('body').bind('pinchclose', resetRack); */
}


