/*
  My Garage mods builder (my-builds.html, on a car's page).

  Once a car is in the garage its owner builds its mods list one area at a
  time: each area is Stock or Upgraded, and Upgraded asks that area's
  questions (wheel size and offset, suspension make and drop, PPF coverage
  and so on). When it was fitted, who fitted it and what it cost are only
  ever shown to the owner.

  Saving sends { specs, plans, version, year } to PUT /my-builds/car. The
  worker keeps them privately and makes the public mods list from them
  (specsToMods in workers/vote-worker.js), which is what the reel, gallery,
  vote and search show. The area and answer names here must match
  MOD_AREAS there.

  The list shows as drop-down rows (js/mods-view.js, from car.view, which
  the worker makes); Edit opens that area's form in its row.

  Use: MT3UKModsBuilder.mount(element, { save: function (fields) -> Promise
  of the worker's reply }) returns { show: function (car) }.
*/
(function () {
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Versions of each model, oldest first, for the Version drop-downs in My
  // Garage (next to Model). Highland is the 2024 Model 3 refresh, Juniper
  // the 2025 Model Y.
  var CAR_VERSIONS = {
    'Model S': ['60', '60D', '70', '70D', '75', '75D', '85', '85D', 'P85', 'P85+', 'P85D', '90D', 'P90D', '100D', 'P100D',
      'Long Range', 'Long Range Plus', 'Performance', 'Plaid', 'Dual Motor All-Wheel Drive'],
    'Model X': ['60D', '70D', '75D', '90D', 'P90D', '100D', 'P100D', 'Long Range', 'Long Range Plus', 'Performance', 'Plaid',
      'Dual Motor All-Wheel Drive'],
    'Model 3': ['Standard Range', 'Standard Range Plus', 'Mid Range', 'Long Range RWD', 'Long Range AWD', 'Performance',
      'Rear-Wheel Drive', 'Highland Rear-Wheel Drive', 'Highland Long Range RWD', 'Highland Long Range AWD', 'Highland Performance'],
    'Model Y': ['Standard Range', 'Rear-Wheel Drive', 'Long Range RWD', 'Long Range AWD', 'Performance',
      'Juniper Standard', 'Juniper Rear-Wheel Drive', 'Juniper Long Range RWD', 'Juniper Long Range AWD', 'Juniper Performance'],
    // Other cars: the Ioniq 5 N (2024 on) and 6 N (2025 on) come in one
    // version; the Taycan saloon (2019 on), Cross Turismo and Sport Turismo.
    'Hyundai Ioniq 5 N': ['Ioniq 5 N'],
    'Hyundai Ioniq 6 N': ['Ioniq 6 N'],
    'Porsche Taycan': ['Taycan', '4', '4S', 'GTS', 'Turbo', 'Turbo S', 'Turbo GT', 'Turbo GT Weissach Package',
      '4 Cross Turismo', '4S Cross Turismo', 'Turbo Cross Turismo', 'Turbo S Cross Turismo', 'GTS Sport Turismo']
  };
  var FIRST_CAR_YEAR = 2012;

  // The Version drop-down's options for a model; a saved version that isn't
  // listed stays as an option.
  function versionOptions(model, value) {
    var list = (CAR_VERSIONS[model] || []).slice();
    if (value && list.indexOf(value) === -1) list.push(value);
    return '<option value="">' + (model ? 'Version' : 'Pick the model first') + '</option>' +
      list.map(function (v) { return '<option' + (v === value ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('') +
      (model ? '<option value="Other"' + (value === 'Other' ? ' selected' : '') + '>Other or not sure</option>' : '');
  }

  // Years from this year back to 2012, newest first.
  function yearOptions(value) {
    var now = new Date().getFullYear(), years = [];
    for (var y = now; y >= FIRST_CAR_YEAR; y--) years.push(y);
    value = parseInt(value, 10) || '';
    if (value && years.indexOf(value) === -1) years.push(value);
    return '<option value="">Year</option>' + years.map(function (y) { return '<option value="' + y + '"' + (y === value ? ' selected' : '') + '>' + y + '</option>'; }).join('');
  }

  // [answer name, label, placeholder or choices]
  var AREAS = [
    { id: 'wheels', label: 'Wheels', fields: [
      ['make', 'Make', 'e.g. Vossen'], ['model', 'Model', 'e.g. HF-2'],
      ['sizeFront', 'Size (front)', 'e.g. 20in'], ['sizeRear', 'Size (rear)', 'Same as front if not staggered'],
      ['width', 'Width', 'e.g. 9J'], ['offset', 'Offset (ET)', 'e.g. ET35'],
      ['finish', 'Finish', 'e.g. Gloss black'], ['type', 'Type', ['Cast', 'Flow formed', 'Forged']]
    ], spacers: true },
    { id: 'tyres', label: 'Tyres', fields: [
      ['make', 'Make', 'e.g. Michelin'], ['model', 'Model', 'e.g. Pilot Sport 4S'], ['size', 'Size', 'e.g. 245/35 R20']
    ] },
    { id: 'suspension', label: 'Suspension', coil: true, fields: [
      ['type', 'Type', ['Coilovers', 'Lowering springs', 'Adjustable links', 'Control arms', 'Anti-roll bars', 'Air suspension', 'Other']],
      ['make', 'Make', 'e.g. KW'], ['model', 'Model', 'e.g. V3'], ['drop', 'Drop', 'e.g. 35mm'],
      ['notes', 'Notes (only you see these)', 'Anything else about it']
    ] },
    { id: 'brakes', label: 'Brakes', fields: [
      ['#', 'Front'],
      ['frontCalipers', 'Calipers', 'e.g. AP Racing CP9660'], ['frontDiscs', 'Discs', 'e.g. 372x32 slotted'], ['frontPads', 'Pads', 'e.g. Pagid RSL29'],
      ['#', 'Rear'],
      ['rearCalipers', 'Calipers', 'e.g. Stock, painted orange'], ['rearDiscs', 'Discs', 'e.g. 355x24'], ['rearPads', 'Pads', 'e.g. Pagid RSL29'],
      ['#', 'Front and rear'],
      ['fluid', 'Fluid and lines', 'e.g. Motul RBF 660, braided lines']
    ], moreFields: [['part', 'Part', 'e.g. Brake cooling ducts'], ['makeModel', 'Make and model', '']] },
    { id: 'bodywork', label: 'Bodywork', kinds: [
      ['wrap', 'Wrap', [['make', 'Make', 'e.g. 3M'], ['colour', 'Colour and finish', 'e.g. 2080 Satin Dark Grey']]],
      ['ppf', 'PPF', [['make', 'Make', 'e.g. XPEL'], ['model', 'Film', 'e.g. Ultimate Plus'], ['coverage', 'Coverage', ['Full car', 'Front end', 'Track pack', 'Other']]]],
      ['tint', 'Tint', [['front', 'Front', 'e.g. 35%'], ['rear', 'Rear', 'e.g. 20%']]],
      ['aero', 'Aero', [['parts', 'Parts', 'e.g. Splitter, spoiler'], ['make', 'Make', 'e.g. Maxton'], ['material', 'Material', ['Carbon', 'Plastic', 'Fibreglass', 'Other']]]],
      ['dechrome', 'De-chrome', [['what', 'What', 'e.g. Window trim, badges']]],
      ['lights', 'Lights', [['what', 'What', 'e.g. Smoked side repeaters']]]
    ], moreFields: [['part', 'Part', 'e.g. Front bumper'], ['makeModel', 'Make and model', 'e.g. Robot Crypton']] },
    { id: 'interior', label: 'Interior', picks: ['Seats', 'Wheel or yoke', 'Carbon trim', 'Mats', 'Screens', 'Wraps'], fields: [
      ['makeModel', 'Make and model', 'e.g. Recaro Sportster'], ['details', 'Details', 'Anything else about it']
    ] },
    { id: 'performance', label: 'Performance', picks: ['Acceleration Boost', 'Cooling', 'Other'], fields: [
      ['makeModel', 'Make and model', ''], ['details', 'Details', '']
    ] },
    { id: 'audio', label: 'Audio and tech', picks: ['Speakers', 'Amp', 'Sub', 'Dashcam', 'Chargers'], fields: [
      ['makeModel', 'Make and model', 'e.g. Focal, Hertz'], ['details', 'Details', '']
    ] },
    { id: 'other', label: 'Anything else', items: true }
  ];

  // Sorting mods listed before the builder into its areas, by keywords.
  // Checked in this order, so "steering wheel" is interior, not wheels.
  var SORT_RULES = [
    ['interior', /\b(seats?|steering|yoke|interior|dash|mats?|ambient|alcantara|console|headliner)\b/i],
    ['audio', /\b(speakers?|amps?|amplifier|subs?|subwoofer|audio|dash ?cam|dashcam|camera|chargers?|charging pad|transmitter|teslogic|hud)\b/i],
    ['brakes', /\b(brakes?|calipers?|callipers?|discs?|rotors?|pads?|brake fluid)\b/i],
    ['tyres', /\b(tyres?|tires?|michelin|pirelli|continental|pilot sport)\b/i],
    ['wheels', /\b(wheels?|rims?|forged|alloys?|spacers?)\b|\b\d{2}\s?x\s?\d{1,2}(\.\d)?\b/i],
    ['suspension', /\b(coilovers?|springs?|lowering|arms?|links?|anti-?roll|sway ?bars?|struts?|dampers?|air suspension|air ride|camber|bushe?s|suspension)\b/i],
    ['bodywork', /\b(wrap|wrapped|vinyl|ppf|tint|tinted|bumper|diffuser|spoiler|splitter|lip|skirts?|wing|bonnet|badges?|chrome|de-?chrome|headlights?|tail ?lights?|lights?|body ?kit|mirror)\b/i],
    ['performance', /\b(boost|acceleration|cooling|intake|tune|remap)\b/i]
  ];
  function sortMods(lines) {
    var out = { rest: [] };
    lines.forEach(function (line) {
      for (var i = 0; i < SORT_RULES.length; i++) {
        if (SORT_RULES[i][1].test(line)) {
          (out[SORT_RULES[i][0]] = out[SORT_RULES[i][0]] || []).push(line);
          return;
        }
      }
      out.rest.push(line);
    });
    return out;
  }

  var ICON = {
    chev: '<svg class="icon mbm-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    wrench: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.5 4.6L3 17.1V21h3.9l6.2-6.2a4 4 0 0 0 4.6-5.5l-2.6 2.6-1.9-.5-.5-1.9Z"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    bin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    tick: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>'
  };

  function yearSelect(id, attrs, value) {
    return '<select class="field" id="' + id + '" ' + attrs + '>' + yearOptions(value) + '</select>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function copy(o) { return JSON.parse(JSON.stringify(o || {})); }

  function skipKey(carId) { return 'mt3ukModsSkip:' + carId; }
  function skipped(carId) { try { return localStorage.getItem(skipKey(carId)) === '1'; } catch (e) { return false; } }
  function setSkipped(carId) { try { localStorage.setItem(skipKey(carId), '1'); } catch (e) {} }

  function mount(root, opts) {
    var car = null, specs = {}, plans = [], uid = 0, sortedNote = false;
    var openRows = {}, editing = null;

    function cancelEdit() {
      specs = copy(car.specs);
      editing = null;
    }

    // Start: the mods listed before are sorted into areas and saved, so the
    // rows show them; with none, the first area opens to fill in.
    function start() {
      var status = root.querySelector('[data-start-status]');
      if (status) status.textContent = 'Setting up your list…';
      var hadMods = !!(specs.wheels || specs.suspension || specs.brakes || specs.bodywork || specs.interior || specs.audio || specs.tyres || specs.performance || specs.other);
      save(null).then(function (d) {
        if (!d) { if (status) status.textContent = 'Could not start, please try again.'; return; }
        sortedNote = hadMods;
        if (!hadMods) { editing = 'wheels'; openRows.wheels = true; }
        listOpen = true;
        render();
      });
    }

    // Moves the lines under Anything else into their areas (as extra
    // parts), marking those areas Upgraded. Anything unmatched stays put.
    function sortOther() {
      var lines = (specs.other && specs.other.items) || [];
      if (!lines.length) return false;
      var sorted = sortMods(lines);
      var moved = false;
      AREAS.forEach(function (a) {
        if (a.id === 'other' || !sorted[a.id]) return;
        var s = specs[a.id] && specs[a.id].status === 'up' ? specs[a.id] : { status: 'up' };
        s.items = (s.items || []).concat(sorted[a.id]);
        specs[a.id] = s;
        moved = true;
      });
      if (sorted.rest.length) specs.other = { status: 'up', items: sorted.rest };
      else delete specs.other;
      return moved;
    }

    function areaDone(id) { return !!(specs[id] && (specs[id].status === 'stock' || specs[id].status === 'up')); }
    function doneCount() { return AREAS.filter(function (a) { return areaDone(a.id); }).length; }
    function statusPill(id) {
      if (!areaDone(id)) return '<span class="mbm-pill mbm-pill-todo">To do</span>';
      return specs[id].status === 'up' ? '<span class="mbm-pill mbm-pill-up">Upgraded</span>' : '<span class="mbm-pill mbm-pill-stock">Stock</span>';
    }
    function meter(dark) {
      var n = doneCount();
      return '<div class="mbm-meter' + (dark ? ' mbm-meter-dark' : '') + '"><div class="mbm-meter-bar"><span style="width:' + Math.round(n / AREAS.length * 100) + '%"></span></div>' +
        '<span class="mbm-meter-text">' + n + ' of ' + AREAS.length + ' areas done</span></div>';
    }

    function field(prefix, f, value) {
      if (f[0] === '#') return '<p class="mbm-group">' + esc(f[1]) + '</p>';
      var id = 'mbm-' + (++uid);
      var label = '<label for="' + id + '">' + esc(f[1]) + '</label>';
      if (Array.isArray(f[2])) {
        return '<div class="mbm-field">' + label + '<select class="field" id="' + id + '" data-f="' + prefix + f[0] + '"><option value="">Choose</option>' +
          f[2].map(function (o) { return '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
      }
      return '<div class="mbm-field">' + label + '<input class="field" id="' + id + '" data-f="' + prefix + f[0] + '" maxlength="80" placeholder="' + esc(f[2]) + '" value="' + esc(value || '') + '"></div>';
    }

    // When and where, for a part. prefix is where it is saved, such as
    // "kinds.wrap." or "more.0." ("" for the area's main part).
    function fittedHtml(prefix, fit) {
      fit = fit || {};
      var m = 'mbm-' + (++uid), y = 'mbm-' + (++uid), b = 'mbm-' + (++uid), c = 'mbm-' + (++uid);
      return '<div class="mbm-private"><p class="mbm-private-title">When and where <span class="mbm-pill mbm-pill-private">Only you see these</span></p><div class="mbm-grid">' +
        '<div class="mbm-field"><label for="' + m + '">Month fitted</label><select class="field" id="' + m + '" data-f="' + prefix + 'fitted.month"><option value="">Month</option>' +
        MONTHS.map(function (mm, i) { return '<option value="' + (i + 1) + '"' + (fit.month === i + 1 ? ' selected' : '') + '>' + mm + '</option>'; }).join('') + '</select></div>' +
        '<div class="mbm-field"><label for="' + y + '">Year fitted</label>' + yearSelect(y, 'data-f="' + prefix + 'fitted.year"', fit.year) + '</div>' +
        '<div class="mbm-field"><label for="' + b + '">Fitted by</label><input class="field" id="' + b + '" data-f="' + prefix + 'fitted.by" maxlength="80" placeholder="A garage, or yourself" value="' + esc(fit.by || '') + '"></div>' +
        '<div class="mbm-field"><label for="' + c + '">Cost</label><input class="field" id="' + c + '" data-f="' + prefix + 'fitted.cost" maxlength="20" placeholder="£" value="' + esc(fit.cost || '') + '"></div>' +
        '</div></div>';
    }

    // Coilover settings: rebound and compression, front and rear, for road
    // and track. Shown when the type is Coilovers.
    function coilHtml(prefix, vals) {
      var on = vals.type === 'Coilovers';
      var h = '<div class="mbm-sub" data-coil' + (on ? '' : ' hidden') + '><p class="mbm-sub-title">Coilover settings <span class="mbm-pill mbm-pill-stock">Shown on your build</span></p>';
      [['road', 'Road'], ['track', 'Track']].forEach(function (use) {
        h += '<div class="mbm-grid mbm-coil-grid">' + field(prefix, ['#', use[1]]) + [
          ['ReboundFront', 'Rebound front'], ['ReboundRear', 'Rebound rear'],
          ['CompressionFront', 'Compression front'], ['CompressionRear', 'Compression rear']
        ].map(function (c) { return field(prefix, [use[0] + c[0], c[1], 'e.g. 8 clicks'], vals[use[0] + c[0]]); }).join('') + '</div>';
      });
      return h + '</div>';
    }

    function entryHtml(a, fields, prefix, vals) {
      return '<div class="mbm-grid">' + fields.map(function (f) { return field(prefix, f, vals[f[0]]); }).join('') + '</div>' +
        (a.coil ? coilHtml(prefix, vals) : '');
    }

    // "+ More": further parts in the same area.
    function moreHtml(a, s) {
      var fields = a.moreFields || a.fields;
      if (!fields) return '';
      var noun = a.label.toLowerCase();
      return (s.more || []).map(function (m, i) {
        return '<div class="mbm-more" data-more="' + i + '"><div class="mbm-more-head"><p class="mbm-sub-title">More ' + esc(noun) + '</p>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-more-remove aria-label="Remove this part">' + ICON.bin + 'Remove</button></div>' +
          entryHtml(a, fields, 'more.' + i + '.', m || {}) + fittedHtml('more.' + i + '.', (m || {}).fitted) + '</div>';
      }).join('') +
        '<div class="mbm-row"><button type="button" class="btn btn-secondary btn-sm" data-more-add>' + ICON.plus + 'More ' + esc(noun) + '</button></div>';
    }

    function upgradedHtml(a, s) {
      var h = '';
      if (a.picks) {
        h += '<div class="mbm-field"><span class="mbm-label">What have you changed?</span><div class="mbm-chips">' + a.picks.map(function (p) {
          var on = (s.picks || []).indexOf(p) !== -1;
          return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-pick="' + esc(p) + '" aria-pressed="' + on + '">' + esc(p) + '</button>';
        }).join('') + '</div></div>';
      }
      if (a.fields) h += entryHtml(a, a.fields, 'fields.', s.fields || {});
      if (a.kinds) {
        var kinds = s.kinds || {};
        h += '<div class="mbm-field"><span class="mbm-label">What have you done?</span><div class="mbm-chips">' + a.kinds.map(function (k) {
          var on = !!kinds[k[0]];
          return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-kind="' + k[0] + '" aria-pressed="' + on + '">' + esc(k[1]) + '</button>';
        }).join('') + '</div></div>';
        a.kinds.forEach(function (k) {
          var kv = kinds[k[0]];
          h += '<div class="mbm-sub" data-kind-body="' + k[0] + '"' + (kv ? '' : ' hidden') + '><p class="mbm-sub-title">' + esc(k[1]) + '</p><div class="mbm-grid">' +
            k[2].map(function (f) { return field('kinds.' + k[0] + '.', f, (kv || {})[f[0]]); }).join('') + '</div>' +
            fittedHtml('kinds.' + k[0] + '.', (kv || {}).fitted) + '</div>';
        });
      }
      if (a.spacers) {
        var sp = s.spacers || {};
        var hub = 'mbm-' + (++uid);
        h += '<div class="mbm-sub"><p class="mbm-sub-title">Spacers</p>' +
          '<div class="mbm-toggle" role="group" aria-label="Spacers"><button type="button" data-spacers="0" aria-pressed="' + !sp.on + '">None</button><button type="button" data-spacers="1" aria-pressed="' + !!sp.on + '">Fitted</button></div>' +
          '<div class="mbm-grid" data-spacers-body' + (sp.on ? '' : ' hidden') + '>' +
          field('spacers.', ['make', 'Spacer make', 'e.g. H&R'], sp.make) + field('spacers.', ['front', 'Front spacers', 'e.g. 15mm'], sp.front) + field('spacers.', ['rear', 'Rear spacers', 'e.g. 20mm'], sp.rear) +
          '<label class="mbm-switch" for="' + hub + '"><input type="checkbox" id="' + hub + '" data-f="spacers.hub"' + (sp.hub ? ' checked' : '') + '> Hub-centric</label></div></div>';
      }
      var t = 'mbm-' + (++uid);
      if (a.items) {
        h += '<div class="mbm-field"><label for="' + t + '">One mod per line</label><textarea class="field" id="' + t + '" data-f="items" rows="4" placeholder="Anything not covered above">' + esc((s.items || []).join('\n')) + '</textarea></div>';
        if ((s.items || []).length) h += '<div class="mbm-row"><button type="button" class="btn btn-secondary btn-sm" data-sort>Sort into areas</button><span class="mbm-hint">Moves each one to the area it belongs in, such as wheels or brakes.</span></div>';
      } else {
        h += moreHtml(a, s);
        // Parts sorted in from an older mods list, as written.
        if ((s.items || []).length) {
          h += '<div class="mbm-field"><label for="' + t + '">Also fitted (one per line)</label><textarea class="field" id="' + t + '" data-f="items" rows="' + Math.max(2, s.items.length) + '">' + esc(s.items.join('\n')) + '</textarea></div>';
        }
        if (!a.kinds) h += fittedHtml('', s.fitted);
      }
      return h;
    }

    // The form for one area, shown in its row after Edit.
    function areaHtml(a) {
      var s = specs[a.id] || {};
      var up = s.status === 'up';
      return '<div class="mbm-area" data-area="' + a.id + '">' +
        '<div class="mbm-area-body">' +
          '<div class="mbm-toggle" role="group" aria-label="' + esc(a.label) + '">' +
            '<button type="button" data-status="stock" aria-pressed="' + (s.status === 'stock') + '">Stock</button>' +
            '<button type="button" data-status="up" aria-pressed="' + up + '">Upgraded</button>' +
          '</div>' +
          '<div class="mbm-up" data-up-body' + (up ? '' : ' hidden') + '>' + upgradedHtml(a, s) + '</div>' +
          '<div class="mbm-actions"><button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button type="button" class="btn btn-primary btn-sm" data-save>Save</button><span class="mbm-saved" data-saved role="status"></span></div>' +
        '</div></div>';
    }

    function planHtml(p, i) {
      var a = 'mbm-' + (++uid), w = 'mbm-' + (++uid), n = 'mbm-' + (++uid);
      return '<div class="mbm-plan" data-plan="' + i + '">' +
        '<div class="mbm-field"><label for="' + a + '">Area</label><select class="field" id="' + a + '" data-p="area"><option value="">Choose</option>' +
          AREAS.map(function (x) { return '<option' + (x.label === p.area ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + '</select></div>' +
        '<div class="mbm-field"><label for="' + w + '">What</label><input class="field" id="' + w + '" data-p="what" maxlength="150" placeholder="e.g. Big brake kit" value="' + esc(p.what || '') + '"></div>' +
        '<div class="mbm-field"><label for="' + n + '">When, roughly (only you see this)</label><input class="field" id="' + n + '" data-p="when" maxlength="40" placeholder="e.g. Summer 2027" value="' + esc(p.when || '') + '"></div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-plan-remove aria-label="Remove this plan">' + ICON.bin + 'Remove</button></div>';
    }

    function welcomeHtml() {
      return '<div class="mbm-welcome">' +
        '<h3>Let\'s build ' + esc(car.name || 'your car') + '\'s mods list</h3>' +
        '<p>Pick what you\'ve changed and we\'ll ask the right questions: wheels, suspension, brakes, wrap and the rest. Anything still stock takes one tap.' +
        ((car.mods || []).length ? ' The mods you listed before are sorted into areas for you.' : '') + '</p>' +
        meter(true) +
        '<div class="mbm-row"><button type="button" class="btn btn-accent" data-start>Start</button><button type="button" class="btn btn-ghost mbm-skip" data-skip>Skip for now</button></div>' +
        '<p class="mbm-saved" data-start-status role="status"></p>' +
      '</div>';
    }

    // A row of our own (car details, plans, what others see), drawn like
    // the area rows in js/mods-view.js.
    function extraRow(id, label, count, body, iconName, isNew) {
      var isOpen = !!openRows[id];
      return '<div class="mv-area' + (isOpen ? ' is-open' : '') + '" data-mv-area="' + id + '">' +
        '<button type="button" class="mv-row" data-mv-open="' + id + '" aria-expanded="' + isOpen + '">' +
        (iconName ? window.MT3UKModsView.icon(iconName, 'mv-eye') : '') +
        '<span class="mv-name">' + esc(label) + (isNew ? ' <span class="mv-new">NEW</span>' : '') + '</span><span class="mv-count">' + esc(count) + '</span>' + window.MT3UKModsView.icon('chev', 'mv-chev') + '</button>' +
        (isOpen ? '<div class="mv-body">' + body + '</div>' : '') + '</div>';
    }

    function plansHtml() {
      return '<p class="mbm-hint">Plans for further mods or changes.</p>' +
        '<div class="mbm-plan-list">' + plans.map(planHtml).join('') + '</div>' +
        '<div class="mbm-row"><button type="button" class="btn btn-secondary btn-sm" data-plan-add>' + ICON.plus + 'Add a plan</button><button type="button" class="btn btn-primary btn-sm" data-plans-save>Save plans</button><span class="mbm-saved" data-plans-saved role="status"></span></div>';
    }

    // The Mods list starts folded away; the heading opens it.
    var listOpen = false;
    function render() {
      if (!car) { root.innerHTML = ''; return; }
      if (!car.specs && !skipped(car.id)) { root.innerHTML = welcomeHtml(); return; }
      var MV = window.MT3UKModsView;
      var view = car.view || [];
      var done = view.filter(function (a) { return a.status !== 'todo' && a.id !== 'mods'; }).length;
      var h = '<div class="mbm-list-head"><div><button type="button" class="mbm-fold" data-list-toggle aria-expanded="' + listOpen + '"><h3>' + ICON.wrench + 'Mods list</h3>' + MV.icon('chev', 'mv-chev') + '</button>' +
        (listOpen ? '<p class="mbm-hint">Tap an area to see what\'s in it, then Edit to change it.</p>' : '') + '</div>' +
        (car.specs ? '<div class="mbm-meter"><div class="mbm-meter-bar"><span style="width:' + Math.round(done / AREAS.length * 100) + '%"></span></div><span class="mbm-meter-text">' + done + ' of ' + AREAS.length + ' areas done</span></div>'
          : '<button type="button" class="btn btn-accent btn-sm" data-start>Build my mods list</button>') + '</div>';
      if (listOpen) {
        if (sortedNote) h += '<p class="mbm-note">We\'ve put your existing mods into areas. Open each one to check it, and Edit to add sizes, dates and so on.</p>';
        h += '<div class="mv-rows mv-two">' + MV.rows(view, { owner: true, open: openRows, editing: editing, editHtml: function (id) {
          return areaHtml(AREAS.filter(function (x) { return x.id === id; })[0]);
        } }) + '</div>';
      }
      var n = MV.publicCount(view);
      var galleryLink = car.photos && car.photos[0] ? 'gallery.html?photo=' + encodeURIComponent(car.photos[0].file || car.photos[0]) : 'gallery.html';
      h += '<div class="mv-rows">' +
        (car.specs ? extraRow('plans', 'What\'s next?', plans.length ? plans.length + (plans.length === 1 ? ' plan' : ' plans') : '', plansHtml()) : '') +
        extraRow('public', 'What others see', n + (n === 1 ? ' mod' : ' mods'),
          (MV.publicList(view) || '<p class="mbm-hint">Nothing yet. Add your mods above and they show here.</p>') +
          '<div class="mbm-row"><a class="btn btn-secondary btn-sm" href="' + galleryLink + '">See it in the Gallery</a></div>', 'eye') +
        '</div>';
      root.innerHTML = h;
    }

    // Reads one area's answers from the page into specs.
    function readArea(box) {
      var id = box.getAttribute('data-area');
      var a = AREAS.filter(function (x) { return x.id === id; })[0];
      var s = specs[id] || {};
      if (s.status !== 'up') return;
      var next = { status: 'up' };
      box.querySelectorAll('[data-f]').forEach(function (el) {
        if (el.closest('[hidden]')) return;
        var path = el.getAttribute('data-f').split('.');
        var value = el.type === 'checkbox' ? el.checked : el.value.trim();
        if (path[0] === 'items') {
          next.items = value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
          return;
        }
        if (value === '' || value === false) return;
        var o = next;
        for (var i = 0; i < path.length - 1; i++) { o[path[i]] = o[path[i]] || {}; o = o[path[i]]; }
        var last = path[path.length - 1];
        o[last] = (path[path.length - 2] === 'fitted' && (last === 'month' || last === 'year')) ? parseInt(value, 10) || '' : value;
      });
      if (a.picks) {
        next.picks = [];
        box.querySelectorAll('[data-pick].is-on').forEach(function (b) { next.picks.push(b.getAttribute('data-pick')); });
      }
      if (a.kinds) {
        next.kinds = next.kinds || {};
        box.querySelectorAll('[data-kind].is-on').forEach(function (b) {
          var k = b.getAttribute('data-kind');
          next.kinds[k] = next.kinds[k] || {};
        });
      }
      if (a.spacers) {
        var on = box.querySelector('[data-spacers="1"]').getAttribute('aria-pressed') === 'true';
        if (on) { next.spacers = next.spacers || {}; next.spacers.on = true; } else delete next.spacers;
      }
      // Keep "More" rows, even empty ones just added, in their order.
      var moreRows = box.querySelectorAll('[data-more]').length;
      if (moreRows) {
        var m = next.more || {};
        next.more = [];
        for (var r = 0; r < moreRows; r++) next.more.push(m[r] || {});
      }
      specs[id] = next;
    }

    function readPlans() {
      plans = [];
      root.querySelectorAll('[data-plan]').forEach(function (row) {
        var p = {};
        row.querySelectorAll('[data-p]').forEach(function (el) { p[el.getAttribute('data-p')] = el.value.trim(); });
        plans.push(p);
      });
    }

    function readCar() {
      var out = {};
      root.querySelectorAll('[data-car]').forEach(function (el) { out[el.getAttribute('data-car')] = el.value.trim(); });
      return out;
    }

    function save(note) {
      root.querySelectorAll('.mbm-area').forEach(readArea);
      if (root.querySelector('.mbm-plan-list')) readPlans();
      var fields = Object.assign({ specs: specs, plans: plans.filter(function (p) { return p.what; }) }, root.querySelector('[data-car]') ? readCar() : {});
      if (note) { note.textContent = 'Saving…'; note.className = note.className.replace(/ is-err/, ''); }
      return opts.save(fields).then(function (data) {
        if (!data || !data.success) throw new Error((data && data.message) || '');
        var saved = data.car || {};
        car.specs = saved.specs || copy(specs);
        car.plans = saved.plans || plans;
        car.mods = saved.mods || car.mods;
        if (saved.view) car.view = saved.view;
        if ('version' in saved) car.version = saved.version;
        if ('year' in saved) car.year = saved.year;
        specs = copy(car.specs);
        if (note) note.innerHTML = ICON.tick + 'Saved';
        if (opts.onSaved) opts.onSaved(car);
        return data;
      }).catch(function () {
        if (note) { note.textContent = 'Could not save, please try again.'; note.className += ' is-err'; }
        return null;
      });
    }

    // Coilover settings appear when the type is Coilovers.
    root.addEventListener('change', function (e) {
      var sel = e.target;
      if (!sel.matches || !sel.matches('select[data-f$=".type"]')) return;
      var holder = sel.closest('.mbm-more') || sel.closest('.mbm-up');
      var coil = holder && holder.querySelector(':scope > [data-coil]');
      if (coil) coil.hidden = sel.value !== 'Coilovers';
    });

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-start]')) { start(); return; }
      if (t.closest('[data-list-toggle]')) { listOpen = !listOpen; if (!listOpen && editing) cancelEdit(); render(); return; }
      if (t.closest('[data-skip]')) { setSkipped(car.id); render(); return; }
      var mvOpen = t.closest('[data-mv-open]');
      if (mvOpen) {
        var rowId = mvOpen.getAttribute('data-mv-open');
        openRows[rowId] = !openRows[rowId];
        if (!openRows[rowId] && editing === rowId) cancelEdit();
        render();
        return;
      }
      var mvEdit = t.closest('[data-mv-edit]');
      if (mvEdit) {
        if (editing) cancelEdit();
        editing = mvEdit.getAttribute('data-mv-edit');
        openRows[editing] = true;
        render();
        var form = root.querySelector('.mbm-area[data-area="' + editing + '"]');
        if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (t.closest('[data-cancel]')) { cancelEdit(); render(); return; }
      var box = t.closest('.mbm-area');
      var status = t.closest('[data-status]');
      if (status && box) {
        var id = box.getAttribute('data-area');
        var up = status.getAttribute('data-status') === 'up';
        if (up) {
          specs[id] = Object.assign({}, specs[id] || {}, { status: 'up' });
        } else {
          specs[id] = { status: 'stock' };
        }
        box.querySelectorAll('[data-status]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === status)); });
        box.querySelector('[data-up-body]').hidden = !up;
        var pillEl = box.querySelector('[data-pill]');
        if (pillEl) pillEl.innerHTML = statusPill(id);
        return;
      }
      var chip = t.closest('[data-pick], [data-kind]');
      if (chip) {
        var on = !chip.classList.contains('is-on');
        chip.classList.toggle('is-on', on);
        chip.setAttribute('aria-pressed', String(on));
        if (chip.hasAttribute('data-kind')) {
          var body = box.querySelector('[data-kind-body="' + chip.getAttribute('data-kind') + '"]');
          if (body) body.hidden = !on;
        }
        return;
      }
      var sp = t.closest('[data-spacers]');
      if (sp) {
        box.querySelectorAll('[data-spacers]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === sp)); });
        box.querySelector('[data-spacers-body]').hidden = sp.getAttribute('data-spacers') !== '1';
        return;
      }
      if (t.closest('[data-save]')) {
        save(box.querySelector('[data-saved]')).then(function (d) {
          if (!d) return;
          editing = null;
          sortedNote = false;
          render();
        });
        return;
      }
      var addMore = t.closest('[data-more-add]'), removeMore = t.closest('[data-more-remove]');
      if ((addMore || removeMore) && box) {
        var areaId = box.getAttribute('data-area');
        readArea(box);
        var sp = specs[areaId];
        sp.more = sp.more || [];
        if (addMore) sp.more.push({});
        else sp.more.splice(parseInt(removeMore.closest('[data-more]').getAttribute('data-more'), 10), 1);
        var tmp = document.createElement('div');
        tmp.innerHTML = areaHtml(AREAS.filter(function (x) { return x.id === areaId; })[0]);
        box.parentNode.replaceChild(tmp.firstElementChild, box);
        if (addMore) {
          var rows = root.querySelectorAll('.mbm-area[data-area="' + areaId + '"] [data-more]');
          var first = rows.length && rows[rows.length - 1].querySelector('.field');
          if (first) first.focus();
        }
        return;
      }
      if (t.closest('[data-plan-add]')) {
        readPlans();
        plans.push({});
        root.querySelector('.mbm-plan-list').innerHTML = plans.map(planHtml).join('');
        var rows = root.querySelectorAll('[data-plan] [data-p="area"]');
        if (rows.length) rows[rows.length - 1].focus();
        return;
      }
      var rm = t.closest('[data-plan-remove]');
      if (rm) {
        readPlans();
        plans.splice(parseInt(rm.closest('[data-plan]').getAttribute('data-plan'), 10), 1);
        root.querySelector('.mbm-plan-list').innerHTML = plans.map(planHtml).join('');
        return;
      }
      if (t.closest('[data-plans-save]')) {
        save(root.querySelector('[data-plans-saved]')).then(function (d) { if (d) render(); });
      }
      if (t.closest('[data-sort]')) {
        root.querySelectorAll('.mbm-area').forEach(readArea);
        if (root.querySelector('.mbm-plan-list')) readPlans();
        sortedNote = sortOther();
        // Saved straight away, so each area shows what moved into it. The
        // form closes first, so the save doesn't read the old list back.
        editing = null;
        render();
        save(null).then(function () { render(); });
        var note = root.querySelector('.mbm-note');
        if (note && note.scrollIntoView) note.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });

    return {
      show: function (nextCar) {
        var sameCar = car && nextCar && car.id === nextCar.id;
        car = nextCar;
        if (!car) { root.innerHTML = ''; return; }
        specs = copy(car.specs);
        // Mods listed before the builder carry over under Anything else,
        // so nothing is lost on the first save.
        sortedNote = false;
        if (!car.specs && (car.mods || []).length) {
          specs.other = { status: 'up', items: car.mods.slice() };
          sortedNote = sortOther();
        }
        // Bodywork saved with one date for everything: it goes on the
        // first job ticked, so nothing is lost.
        var bw = specs.bodywork;
        if (bw && bw.fitted && bw.kinds) {
          var firstKind = Object.keys(bw.kinds)[0];
          if (firstKind && !bw.kinds[firstKind].fitted) bw.kinds[firstKind].fitted = bw.fitted;
          delete bw.fitted;
        }
        // Brakes saved before front and rear: treat them as the front.
        var br = specs.brakes && specs.brakes.fields;
        if (br && !br.frontCalipers && !br.frontDiscs && !br.frontPads) {
          ['Calipers', 'Discs', 'Pads'].forEach(function (k) {
            var old = k.toLowerCase();
            if (br[old]) { br['front' + k] = br[old]; delete br[old]; }
          });
        }
        plans = copy(car.plans || []);
        if (!Array.isArray(plans)) plans = [];
        if (!sameCar) { openRows = {}; editing = null; }
        render();
      }
    };
  }

  window.MT3UKModsBuilder = { mount: mount, areas: AREAS, sortMods: sortMods, versionOptions: versionOptions, yearOptions: yearOptions, versions: CAR_VERSIONS };
})();
