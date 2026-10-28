import "./style.css";
import "./connection";
import * as globals from "./globals";

const app = document.querySelector('#app');

if (app) {
  app.innerHTML = `
  <div id="connect" style="text-align: center"><table style="display: inline-block">
    <tr><td><span>Host: </span></td><td><input id="host" /></td></tr>
    <tr><td><span>Key: </span></td><td><input id="key" /></td></tr>
    <tr><td><span>Id: </span></td><td><input id="id" /></td></tr>
    <tr><td></td><td><button onclick="connect();">Connect</button></td></tr>
  </table></div>
  <div id="password" style="display: none;">
    <input type="password" id="password-input" />
    <button id="confirm" onclick="submitPassword()">Confirm</button>
    <button id="cancel" onclick="cancel();">Cancel</button>
  </div>
  <div id="status" style="display: none;">
    <div id="text" style="line-height: 2em"></div>
    <button id="cancel" onclick="cancel();">Cancel</button>
  </div>
  <div id="canvas" style="display: none;">
    <button id="cancel" onclick="cancel();">Cancel</button>
  </div>
`;

  window.init();

  document.body.onload = () => {
    const host = document.querySelector('#host');
    host.value = localStorage.getItem('custom-rendezvous-server');
    const id = document.querySelector('#id');
    id.value = localStorage.getItem('id');
    const key = document.querySelector('#key');
    key.value = localStorage.getItem('key');
  };

  window.connect = () => {
    const host = document.querySelector('#host');
    localStorage.setItem('custom-rendezvous-server', host.value);
    const id = document.querySelector('#id');
    localStorage.setItem('id', id.value);
    const key = document.querySelector('#key');
    localStorage.setItem('key', key.value);
    const func = async () => {
      const conn = globals.newConn();
      conn.setMsgbox(msgbox);
      document.querySelector('div#status').style.display = 'block';
      document.querySelector('div#connect').style.display = 'none';
      document.querySelector('div#text').innerHTML = 'Connecting ...';
      await conn.start(id.value);
    };
    func();
  }

  function setStatusText(text, isError) {
    const el = document.querySelector('div#text');
    el.textContent = text;
    el.style.fontWeight = 'bold';
    el.style.color = isError ? 'red' : '';
  }

  function msgbox(type, title, text) {
    if (!globals.getConn()) return;
    if (type == 'input-password') {
      document.querySelector('div#status').style.display = 'none';
      document.querySelector('div#password').style.display = 'block';
    } else if (!type) {
      document.querySelector('div#canvas').style.display = 'block';
      document.querySelector('div#password').style.display = 'none';
      document.querySelector('div#status').style.display = 'none';
    } else if (type == 'error') {
      document.querySelector('div#status').style.display = 'block';
      document.querySelector('div#canvas').style.display = 'none';
      setStatusText(text, true);
    } else {
      document.querySelector('div#password').style.display = 'none';
      document.querySelector('div#status').style.display = 'block';
      setStatusText(text, false);
    }
  }

  window.cancel = () => {
    globals.close();
    document.querySelector('div#connect').style.display = 'block';
    document.querySelector('div#password').style.display = 'none';
    document.querySelector('div#status').style.display = 'none';
    document.querySelector('div#canvas').style.display = 'none';
  }

  window.submitPassword = () => {
    const password = document.querySelector('#password-input').value;
    const conn = globals.getConn();
    if (password && conn) {
      document.querySelector('div#password').style.display = 'none';
      conn.login(password);
    }
  }
}