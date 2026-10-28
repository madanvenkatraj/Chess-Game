(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OpeningExplorer = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var catalog = [
    { id:'sicilian', name:'Sicilian Defense', moves:'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3', explanation:'Black challenges the center asymmetrically.' },
    { id:'sicilian-najdorf', name:'Sicilian Defense: Najdorf', moves:'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6', explanation:'A flexible move preparing queenside expansion.' },
    { id:'italian', name:'Italian Game', moves:'e4 e5 Nf3 Nc6 Bc4 Bc5', explanation:'Develop the bishop actively toward f7.' },
    { id:'italian-giuoco', name:'Italian Game: Giuoco Piano', moves:'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4', explanation:'White prepares a central pawn advance.' },
    { id:'queens-gambit', name:"Queen's Gambit", moves:'d4 d5 c4 e6 Nc3 Nf6', explanation:'White offers a flank pawn to gain central influence.' },
    { id:'queens-accepted', name:"Queen's Gambit Accepted", moves:'d4 d5 c4 dxc4 e3 Nf6', explanation:'Black accepts the pawn and develops.' },
    { id:'ruy-lopez', name:'Ruy Lopez', moves:'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6', explanation:'White pressures the c6 knight and central e5 pawn.' },
    { id:'ruy-berlin', name:'Ruy Lopez: Berlin Defense', moves:'e4 e5 Nf3 Nc6 Bb5 Nf6', explanation:'Black develops and immediately challenges the e4 pawn.' }
  ];
  function normalize(s) { return String(s || '').replace(/[+#?!]+$/g, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O'); }
  function tokens(seq) { return (Array.isArray(seq) ? seq : String(seq || '').trim().split(/\s+/)).filter(Boolean).map(normalize); }
  function search(query) {
    var q = String(query || '').trim().toLowerCase();
    return catalog.filter(function (o) { return !q || (o.name + ' ' + o.moves).toLowerCase().indexOf(q) >= 0; });
  }
  function matchPrefix(sequence) {
    var played = tokens(sequence);
    return catalog.filter(function (o) { var line = tokens(o.moves); return played.length <= line.length && played.every(function (m, i) { return m === line[i]; }); });
  }
  function recognize(sequence) {
    var played = tokens(sequence), matches = matchPrefix(played);
    return { matches: matches, name: matches.length ? matches[0].name : null, sequence: matches.length ? matches[0].moves : null, exact: matches.filter(function (o) { return tokens(o.moves).length === played.length; }) };
  }
  function continuations(sequence) {
    var played = tokens(sequence), found = [];
    matchPrefix(played).forEach(function (o) {
      var line = tokens(o.moves);
      if (line.length > played.length) {
        var move = line[played.length];
        if (!found.some(function (x) { return x.move === move; })) found.push({ move:move, openings:[], explanation:o.explanation });
        found.filter(function (x) { return x.move === move; })[0].openings.push(o);
      }
    });
    return found;
  }
  return { catalog:catalog, search:search, matchPrefix:matchPrefix, recognize:recognize, continuations:continuations, normalize:normalize, tokens:tokens };
});
