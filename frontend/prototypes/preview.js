const loginForm = document.querySelector('#login-form');
const accountTitle = document.querySelector('#account-title');
const accountDescription = document.querySelector('#account-description');
const accountSignedIn = document.querySelector('.account-signed-in');
const farmCard = document.querySelector('.farm-card');
const farmStatus = document.querySelector('#farm-status');
const farmSteps = [...document.querySelectorAll('.step')];
const buildButton = document.querySelector('#build-button');
const eventsList = document.querySelector('#events-list');
const toast = document.querySelector('.toast');
let toastTimer;

function notify(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3300);
}

function addEvent(message, detail) {
  eventsList.querySelector('.empty-event')?.remove();
  const item = document.createElement('li');
  const text = document.createElement('div');
  const secondary = document.createElement('span');
  text.textContent = message;
  secondary.textContent = detail;
  text.append(secondary);
  item.append(text);
  eventsList.prepend(item);
}

function setFarmState(state) {
  const states = {
    idle: { status: '待建造', button: '预览：发起建造', step: 0 },
    building: { status: '建造中', button: '预览：完成建造', step: 1 },
    complete: { status: '已完成', button: '重置演示状态', step: 2 },
  };
  farmCard.dataset.farmState = state;
  farmStatus.textContent = states[state].status;
  buildButton.firstChild.textContent = `${states[state].button} `;
  farmSteps.forEach((step, index) => step.classList.toggle('active', index === states[state].step));
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = new FormData(loginForm).get('username').trim();
  if (!username) return;
  document.querySelector('#account-name').textContent = username;
  accountTitle.textContent = '账号预览';
  accountDescription.textContent = '仅展示本地状态，没有建立连接。';
  loginForm.reset();
  loginForm.hidden = true;
  accountSignedIn.hidden = false;
  notify('这只是登录状态预览，未发送用户名或密码。');
});

document.querySelector('#sign-out').addEventListener('click', () => {
  loginForm.hidden = false;
  accountSignedIn.hidden = true;
  document.querySelector('#account-name').textContent = '';
  accountTitle.textContent = '登录游戏';
  accountDescription.textContent = '输入账号信息，预览登录后的状态。';
});

buildButton.addEventListener('click', () => {
  const state = farmCard.dataset.farmState;
  if (state === 'idle') {
    setFarmState('building');
    addEvent('农场建造已发起', '玩家（本地预览） · 等待完成');
  } else if (state === 'building') {
    setFarmState('complete');
    addEvent('农场建造完成', '原始发起者：玩家（本地预览）');
  } else {
    setFarmState('idle');
    eventsList.replaceChildren();
    const empty = document.createElement('li');
    empty.className = 'empty-event';
    empty.textContent = '暂无事件。建造操作与状态变化会显示在这里。';
    eventsList.append(empty);
  }
  notify('农场状态仅在本页演示，未发送建造指令。');
});

document.querySelector('#query-button').addEventListener('click', () => notify('查询入口仅作布局预览，未连接服务。'));
document.querySelector('#events-button').addEventListener('click', () => notify('历史事件入口仅作布局预览，未连接服务。'));
