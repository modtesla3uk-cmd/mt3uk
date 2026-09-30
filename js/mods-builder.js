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

  Use: MT3UKModsBuilder.mount(element, { save: function (fields) -> Promise
  of the worker's reply }) returns { show: function (car) }.
*/
(function () {
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var VERSIONS = ['Standard Range', 'Standard Range Plus', 'Long Range', 'Performance', 'Plaid', 'Highland', 'Juniper', 'Cyberbeast'];

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
    { id: 'suspension', label: 'Suspension', fields: [
      ['type', 'Type', ['Coilovers', 'Lowering springs', 'Adjustable links', 'Anti-roll bars', 'Air suspension', 'Other']],
      ['make', 'Make', 'e.g. KW'], ['model', 'Model', 'e.g. V3'], ['drop', 'Drop', 'e.g. 35mm'],
      ['notes', 'Settings or notes (only you see these)', 'e.g. Damping 6 front, 8 rear']
    ] },
    { id: 'brakes', label: 'Brakes', fields: [
      ['calipers', 'Calipers', 'e.g. Stock, painted orange'], ['discs', 'Discs', 'e.g. EBC USR'],
      ['pads', 'Pads', 'e.g. Pagid RSL29'], ['fluid', 'Fluid and lines', 'e.g. Motul RBF 660']
    ] },
    { id: 'bodywork', label: 'Bodywork', kinds: [
      ['wrap', 'Wrap', [['make', 'Make', 'e.g. 3M'], ['colour', 'Colour and finish', 'e.g. 2080 Satin Dark Grey']]],
      ['ppf', 'PPF', [['make', 'Make', 'e.g. XPEL'], ['model', 'Film', 'e.g. Ultimate Plus'], ['coverage', 'Coverage', ['Full car', 'Front end', 'Track pack', 'Other']]]],
      ['tint', 'Tint', [['front', 'Front', 'e.g. 35%'], ['rear', 'Rear', 'e.g. 20%']]],
      ['aero', 'Aero', [['parts', 'Parts', 'e.g. Splitter, spoiler'], ['make', 'Make', 'e.g. Maxton'], ['material', 'Material', ['Carbon', 'Plastic', 'Fibreglass', 'Other']]]],
      ['dechrome', 'De-chrome', [['what', 'What', 'e.g. Window trim, badges']]],
      ['lights', 'Lights', [['what', 'What', 'e.g. Smoked side repeaters']]]
    ] },
    { id: 'interior', label: 'Interior', picks: ['Seats', 'Wheel or yoke', 'Carbon trim', 'Mats', 'Screens', 'Wraps'], fields: [
      ['makeModel', 'Make and model', 'e.g. Recaro Sportster'], ['details', 'Details', 'Anything else about it']
    ] },
    { id: 'performance', label: 'Performance', picks: ['Acceleration Boost', 'Track mode', 'Cooling', 'Other'], fields: [
      ['makeModel', 'Make and model', ''], ['details', 'Details', '']
    ] },
    { id: 'audio', label: 'Audio and tech', picks: ['Speakers', 'Amp', 'Sub', 'Dashcam', 'Chargers'], fields: [
      ['makeModel', 'Make and model', 'e.g. Focal, Hertz'], ['details', 'Details', '']
    ] },
    { id: 'other', label: 'Anything else', items: true }
  ];

  var ICON = {
    chev: '<svg class="icon mbm-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    wrench: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.5 4.6L3 17.1V21h3.9l6.2-6.2a4 4 0 0 0 4.6-5.5l-2.6 2.6-1.9-.5-.5-1.9Z"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    bin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    tick: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>'
  };

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
    var car = null, specs = {}, plans = [], openArea = null, building = false, uid = 0;

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
      var id = 'mbm-' + (++uid);
      var label = '<label for="' + id + '">' + esc(f[1]) + '</label>';
      if (Array.isArray(f[2])) {
        return '<div class="mbm-field">' + label + '<select class="field" id="' + id + '" data-f="' + prefix + f[0] + '"><option value="">Choose</option>' +
          f[2].map(function (o) { return '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></div>';
      }
      return '<div class="mbm-field">' + label + '<input class="field" id="' + id + '" data-f="' + prefix + f[0] + '" maxlength="80" placeholder="' + esc(f[2]) + '" value="' + esc(value || '') + '"></div>';
    }

    function fittedHtml(a, s) {
      var fit = s.fitted || {};
      var m = 'mbm-' + (++uid), y = 'mbm-' + (++uid), b = 'mbm-' + (++uid), c = 'mbm-' + (++uid);
      return '<div class="mbm-private"><p class="mbm-private-title">When and where <span class="mbm-pill mbm-pill-private">Only you see these</span></p><div class="mbm-grid">' +
        '<div class="mbm-field"><label for="' + m + '">Month fitted</label><select class="field" id="' + m + '" data-f="fitted.month"><option value="">Month</option>' +
        MONTHS.map(function (mm, i) { return '<option value="' + (i + 1) + '"' + (fit.month === i + 1 ? ' selected' : '') + '>' + mm + '</option>'; }).join('') + '</select></div>' +
        '<div class="mbm-field"><label for="' + y + '">Year fitted</label><input class="field" id="' + y + '" data-f="fitted.year" inputmode="numeric" maxlength="4" placeholder="e.g. 2025" value="' + esc(fit.year || '') + '"></div>' +
        '<div class="mbm-field"><label for="' + b + '">Fitted by</label><input class="field" id="' + b + '" data-f="fitted.by" maxlength="80" placeholder="A garage, or yourself" value="' + esc(fit.by || '') + '"></div>' +
        '<div class="mbm-field"><label for="' + c + '">Cost</label><input class="field" id="' + c + '" data-f="fitted.cost" maxlength="20" placeholder="£" value="' + esc(fit.cost || '') + '"></div>' +
        '</div></div>';
    }

    function upgradedHtml(a, s) {
      var h = '';
      if (a.picks) {
        h += '<div class="mbm-field"><span class="mbm-label">What have you changed?</span><div class="mbm-chips">' + a.picks.map(function (p) {
          var on = (s.picks || []).indexOf(p) !== -1;
          return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-pick="' + esc(p) + '" aria-pressed="' + on + '">' + esc(p) + '</button>';
        }).join('') + '</div></div>';
      }
      if (a.fields) {
        var vals = s.fields || {};
        h += '<div class="mbm-grid">' + a.fields.map(function (f) { return field('fields.', f, vals[f[0]]); }).join('') + '</div>';
      }
      if (a.kinds) {
        var kinds = s.kinds || {};
        h += '<div class="mbm-field"><span class="mbm-label">What have you done?</span><div class="mbm-chips">' + a.kinds.map(function (k) {
          var on = !!kinds[k[0]];
          return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-kind="' + k[0] + '" aria-pressed="' + on + '">' + esc(k[1]) + '</button>';
        }).join('') + '</div></div>';
        a.kinds.forEach(function (k) {
          var kv = kinds[k[0]];
          h += '<div class="mbm-sub" data-kind-body="' + k[0] + '"' + (kv ? '' : ' hidden') + '><p class="mbm-sub-title">' + esc(k[1]) + '</p><div class="mbm-grid">' +
            k[2].map(function (f) { return field('kinds.' + k[0] + '.', f, (kv || {})[f[0]]); }).join('') + '</div></div>';
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
      if (a.items) {
        var t = 'mbm-' + (++uid);
        h += '<div class="mbm-field"><label for="' + t + '">One mod per line</label><textarea class="field" id="' + t + '" data-f="items" rows="4" placeholder="Anything not covered above">' + esc((s.items || []).join('\n')) + '</textarea></div>';
        if (s.fromOld) h += '<p class="mbm-hint">These are the mods you listed before. Move each one into its area above when you have a moment, then take it out of here.</p>';
      }
      if (!a.items) h += fittedHtml(a, s);
      return h;
    }

    function areaHtml(a) {
      var s = specs[a.id] || {};
      var up = s.status === 'up';
      return '<details class="mbm-area" data-area="' + a.id + '"' + (openArea === a.id ? ' open' : '') + '>' +
        '<summary><span class="mbm-area-name">' + esc(a.label) + '</span><span data-pill>' + statusPill(a.id) + '</span>' + ICON.chev + '</summary>' +
        '<div class="mbm-area-body">' +
          '<div class="mbm-toggle" role="group" aria-label="' + esc(a.label) + '">' +
            '<button type="button" data-status="stock" aria-pressed="' + (s.status === 'stock') + '">Stock</button>' +
            '<button type="button" data-status="up" aria-pressed="' + up + '">Upgraded</button>' +
          '</div>' +
          '<div class="mbm-up" data-up-body' + (up ? '' : ' hidden') + '>' + upgradedHtml(a, s) + '</div>' +
          '<div class="mbm-actions"><button type="button" class="btn btn-primary btn-sm" data-save>Save</button><span class="mbm-saved" data-saved role="status"></span></div>' +
        '</div></details>';
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

    function summaryHtml() {
      var welcome = !car.specs && !building && !skipped(car.id);
      if (welcome) {
        return '<div class="mbm-welcome">' +
          '<h3>Let\'s build ' + esc(car.name || 'your car') + '\'s mods list</h3>' +
          '<p>Pick what you\'ve changed and we\'ll ask the right questions: wheels, suspension, brakes, wrap and the rest. Anything still stock takes one tap.</p>' +
          meter(true) +
          '<div class="mbm-row"><button type="button" class="btn btn-accent" data-start>Start</button><button type="button" class="btn btn-ghost mbm-skip" data-skip>Skip for now</button></div>' +
        '</div>';
      }
      var h = '<div class="mbm-summary">' +
        '<div class="mbm-summary-head"><h3>' + ICON.wrench + 'Mods list</h3>' + meter(false) + '</div>' +
        '<div class="mbm-tiles">' + AREAS.map(function (a) {
          return '<button type="button" class="mbm-tile" data-open="' + a.id + '"><span>' + esc(a.label) + '</span>' + statusPill(a.id) + '</button>';
        }).join('') + '</div>';
      if ((car.mods || []).length) {
        h += '<div class="mbm-public"><p class="mbm-label">Shown on your build</p><ul>' + car.mods.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>';
      }
      return h + '</div>';
    }

    function builderHtml() {
      var v = 'mbm-' + (++uid), y = 'mbm-' + (++uid);
      return '<div class="mbm-builder">' +
        '<div class="mbm-about"><p class="mbm-label">About this car</p><div class="mbm-grid">' +
          '<div class="mbm-field"><label for="' + v + '">Version</label><input class="field" id="' + v + '" data-car="version" list="mbm-versions" maxlength="40" placeholder="e.g. Long Range" value="' + esc(car.version || '') + '"></div>' +
          '<div class="mbm-field"><label for="' + y + '">Year</label><input class="field" id="' + y + '" data-car="year" inputmode="numeric" maxlength="4" placeholder="e.g. 2021" value="' + esc(car.year || '') + '"></div>' +
        '</div><datalist id="mbm-versions">' + VERSIONS.map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist></div>' +
        '<div class="mbm-areas">' + AREAS.map(areaHtml).join('') + '</div>' +
        '<div class="mbm-plans"><h3>What\'s next?</h3><p>Plans for further mods or changes.</p>' +
          '<div class="mbm-plan-list">' + plans.map(planHtml).join('') + '</div>' +
          '<div class="mbm-row"><button type="button" class="btn btn-secondary btn-sm" data-plan-add>' + ICON.plus + 'Add a plan</button><button type="button" class="btn btn-primary btn-sm" data-plans-save>Save plans</button><span class="mbm-saved" data-plans-saved role="status"></span></div>' +
        '</div>' +
        '<div class="mbm-row"><button type="button" class="btn btn-secondary" data-close>Done</button></div>' +
      '</div>';
    }

    function render() {
      if (!car) { root.innerHTML = ''; return; }
      root.innerHTML = summaryHtml() + (building ? builderHtml() : '');
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
        o[path[path.length - 1]] = (path[0] === 'fitted' && path[1] !== 'by' && path[1] !== 'cost') ? parseInt(value, 10) || '' : value;
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
      readPlans();
      var fields = Object.assign({ specs: specs, plans: plans.filter(function (p) { return p.what; }) }, readCar());
      if (note) { note.textContent = 'Saving…'; note.className = note.className.replace(/ is-err/, ''); }
      return opts.save(fields).then(function (data) {
        if (!data || !data.success) throw new Error((data && data.message) || '');
        var saved = data.car || {};
        car.specs = saved.specs || copy(specs);
        car.plans = saved.plans || plans;
        car.mods = saved.mods || car.mods;
        if ('version' in saved) car.version = saved.version;
        if ('year' in saved) car.year = saved.year;
        specs = copy(car.specs);
        if (note) note.innerHTML = ICON.tick + 'Saved';
        refreshSummary();
        if (opts.onSaved) opts.onSaved(car);
        return data;
      }).catch(function () {
        if (note) { note.textContent = 'Could not save, please try again.'; note.className += ' is-err'; }
      });
    }

    // After a save, update the pills and the summary without redrawing the
    // form someone is typing in.
    function refreshSummary() {
      root.querySelectorAll('.mbm-area').forEach(function (box) {
        box.querySelector('[data-pill]').innerHTML = statusPill(box.getAttribute('data-area'));
      });
      var first = root.firstElementChild;
      if (!first) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = summaryHtml();
      root.replaceChild(tmp.firstElementChild, first);
    }

    function openBuilder(areaId) {
      if (!building) {
        building = true;
        openArea = areaId || AREAS[0].id;
        render();
      } else {
        root.querySelectorAll('.mbm-area').forEach(function (d) { d.open = d.getAttribute('data-area') === areaId; });
      }
      var target = root.querySelector('.mbm-area[data-area="' + (areaId || AREAS[0].id) + '"]') || root.querySelector('.mbm-builder');
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-start]')) { openBuilder(); return; }
      if (t.closest('[data-skip]')) { setSkipped(car.id); render(); return; }
      var open = t.closest('[data-open]');
      if (open) { openBuilder(open.getAttribute('data-open')); return; }
      if (t.closest('[data-close]')) { building = false; openArea = null; render(); return; }
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
        box.querySelector('[data-pill]').innerHTML = statusPill(id);
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
      if (t.closest('[data-save]')) { save(box.querySelector('[data-saved]')); return; }
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
      if (t.closest('[data-plans-save]')) save(root.querySelector('[data-plans-saved]'));
    });

    return {
      show: function (nextCar) {
        var sameCar = car && nextCar && car.id === nextCar.id;
        car = nextCar;
        if (!car) { root.innerHTML = ''; return; }
        specs = copy(car.specs);
        // Mods listed before the builder carry over under Anything else,
        // so nothing is lost on the first save.
        if (!car.specs && (car.mods || []).length) {
          specs.other = { status: 'up', items: car.mods.slice(), fromOld: true };
        }
        plans = copy(car.plans || []);
        if (!Array.isArray(plans)) plans = [];
        if (!sameCar) { building = false; openArea = null; }
        render();
      }
    };
  }

  window.MT3UKModsBuilder = { mount: mount, areas: AREAS };
})();
