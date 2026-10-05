// 建筑工作区的本地交互演示；不读写游戏状态，也不发送网络请求。
(function () {
  const cells = Array.from(document.querySelectorAll('.city-grid .cell'));
  const position = document.querySelector('#inspector-position');
  const icon = document.querySelector('#inspector-icon');
  const name = document.querySelector('#inspector-name');
  const level = document.querySelector('#inspector-level');
  const effect = document.querySelector('#inspector-effect');
  const status = document.querySelector('#inspector-status');
  const action = document.querySelector('#inspector-action');
  const catalog = document.querySelector('#build-catalog');
  const feedback = document.querySelector('#inspector-feedback');
  let selectedCell = null;

  function setFeedback(message, active) {
    feedback.textContent = message;
    feedback.classList.toggle('active', active);
  }

  function selectCell(cell, focus) {
    cells.forEach(function (item) {
      item.classList.toggle('selected', item === cell);
      item.setAttribute('aria-pressed', item === cell ? 'true' : 'false');
    });
    selectedCell = cell;
    catalog.hidden = true;
    const number = String(cells.indexOf(cell) + 1).padStart(2, '0');
    const empty = cell.dataset.empty === 'true';
    const busy = cell.dataset.busy === 'true';
    position.textContent = '格位 ' + number + ' · ' + (empty ? '可新建' : busy ? '升级中' : '已建成');
    icon.textContent = cell.querySelector('.cn').textContent;
    name.textContent = empty ? '空格位' : cell.dataset.name;
    level.textContent = empty ? '选择一座建筑' : 'Lv ' + cell.dataset.level;
    effect.textContent = empty ? '尚未分配建筑' : cell.dataset.effect;
    status.textContent = empty ? '可新建' : busy ? '升级中 · 5 → 6' : '已建成';
    action.textContent = empty ? '选择建筑' : busy ? '查看建造队列' : '查看升级条件';
    setFeedback(empty ? '从此格位选择建筑，样稿只预览选择流程。'
      : busy ? '校场正在升级，进度见下方建造队列。'
        : '建造与升级条件待确定；此处展示交互位置。', false);
    if (focus) {
      cell.focus();
      cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  cells.forEach(function (cell) {
    cell.addEventListener('click', function () { selectCell(cell, false); });
  });

  document.querySelectorAll('[data-focus-kind]').forEach(function (button) {
    button.addEventListener('click', function () {
      const cell = cells.find(function (item) { return item.dataset.kind === button.dataset.focusKind; });
      if (cell) selectCell(cell, true);
    });
  });

  action.addEventListener('click', function () {
    if (!selectedCell) return;
    if (selectedCell.dataset.empty === 'true') {
      catalog.hidden = !catalog.hidden;
      setFeedback(catalog.hidden ? '从此格位选择建筑，样稿只预览选择流程。'
        : '选择建筑后会在这里展示消耗与确认步骤。', !catalog.hidden);
    } else if (selectedCell.dataset.busy === 'true') {
      document.querySelector('.queue').scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFeedback('已定位到下方建造队列。', true);
    } else {
      setFeedback(selectedCell.dataset.name + '的升级条件会在这里显示；本样稿没有业务数值。', true);
    }
  });

  catalog.querySelectorAll('[data-catalog-kind]').forEach(function (button) {
    button.addEventListener('click', function () {
      setFeedback('已选择' + button.dataset.catalogKind + '；样稿未提交建造，格位保持空置。', true);
      catalog.hidden = true;
    });
  });

  selectCell(document.querySelector('.city-grid .cell.selected'), false);
})();
