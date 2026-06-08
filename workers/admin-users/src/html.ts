export const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Usuarios - El Rey De Las Medialunas</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#FDFBF7;color:#2C1810;min-height:100vh}
.container{max-width:900px;margin:0 auto;padding:24px 16px}
.header{text-align:center;margin-bottom:32px}
.header h1{font-family:Georgia,serif;font-size:2rem;color:#8B4513}
.header .sub{color:#8B7355;font-size:.85rem;margin-top:4px}
.card{background:#fff;border:1px solid #F5DEB3;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card-header{display:flex;align-items:center;gap:8px;margin-bottom:16px;font-weight:700;font-size:.9rem;color:#8B4513}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th{text-align:left;padding:10px 8px;border-bottom:2px solid #F5DEB3;color:#8B4513;font-size:.75rem;text-transform:uppercase;letter-spacing:.5px}
td{padding:10px 8px;border-bottom:1px solid #FAF0E6}
tr:hover td{background:#FFF8DC}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:.7rem;font-weight:700}
.badge-active{background:#E8F5E9;color:#2E7D32}
.badge-disabled{background:#FBE9E7;color:#BF360C}
.badge-verified{background:#E3F2FD;color:#1565C0}
.btn{padding:8px 16px;border-radius:10px;font-size:.8rem;font-weight:700;border:none;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:6px}
.btn:active{transform:scale(.97)}
.btn-primary{background:#8B4513;color:#fff}
.btn-primary:hover{background:#6B3410}
.btn-danger{background:none;color:#BF360C}
.btn-danger:hover{background:#FBE9E7}
.btn-sm{padding:4px 10px;font-size:.7rem}
.actions{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
input,select{padding:8px 12px;border:1px solid #F5DEB3;border-radius:10px;font-size:.85rem;font-family:inherit;background:#FFF8DC}
input:focus,select:focus{outline:none;border-color:#8B4513;box-shadow:0 0 0 3px rgba(139,69,19,.1)}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(2px);z-index:100;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:#fff;border-radius:16px;padding:24px;width:90%;max-width:440px;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.15)}
.modal h3{font-size:1.1rem;color:#8B4513;margin-bottom:16px}
.modal label{display:block;font-size:.75rem;font-weight:700;color:#8B7355;margin-bottom:4px;margin-top:12px}
.modal input,.modal select{width:100%;padding:10px 12px}
.modal .btn-row{display:flex;gap:8px;margin-top:20px}
.modal .btn-row .btn{flex:1;justify-content:center}
.spinner{width:20px;height:20px;border:2px solid #F5DEB3;border-top-color:#8B4513;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;padding:40px 20px;color:#8B7355}
.toast{position:fixed;bottom:24px;right:24px;background:#2C1810;color:#FFF8DC;padding:12px 20px;border-radius:12px;font-size:.8rem;z-index:200;opacity:0;transform:translateY(20px);transition:all .3s}
.toast.show{opacity:1;transform:translateY(0)}
.toast.error{background:#BF360C}
.toast.success{background:#2E7D32}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Admin de Usuarios</h1>
<p class="sub">El Rey De Las Medialunas - Firebase Auth</p>
</div>

<div class="card">
<div class="card-header">Conectar</div>
<div style="display:flex;gap:8px;align-items:center">
<input type="password" id="authSecret" placeholder="Clave de administrador" style="width:200px">
<button class="btn btn-primary" id="btnConnect">Conectar</button>
</div>
<div id="connectStatus"></div>
</div>

<div class="card" id="usersCard" style="display:none">
<div class="card-header">Usuarios <span id="userCount" style="font-weight:400;color:#8B7355;font-size:.8rem"></span></div>
<div class="actions">
<button class="btn btn-primary" id="btnNew">+ Nuevo</button>
<button class="btn btn-sm" id="btnRefresh">Refrescar</button>
</div>
<div style="overflow-x:auto">
<table><thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Creado</th><th style="width:100px"></th></tr></thead><tbody id="usersTable"></tbody></table>
</div>
<div id="emptyState" class="empty" style="display:none"><p>No hay usuarios</p></div>
</div></div>

<div class="modal-overlay" id="modal">
<div class="modal">
<h3 id="modalTitle">Nuevo Usuario</h3>
<form id="userForm">
<input type="hidden" id="editUid">
<label>Email *</label><input type="email" id="fEmail" required>
<label>Nombre</label><input type="text" id="fName">
<label>Contraseña <span id="pwdHint">*</span></label><input type="password" id="fPassword" minlength="6">
<label>Rol</label><select id="fRole"><option value="admin">Administrador</option><option value="cajero">Cajero</option><option value="panadero">Panadero</option></select>
<label>Estado</label><select id="fDisabled"><option value="false">Activo</option><option value="true">Deshabilitado</option></select>
<div class="btn-row">
<button type="button" class="btn" id="btnCancel">Cancelar</button>
<button type="submit" class="btn btn-primary" id="submitBtn">Crear</button>
</div></form></div></div>
<div class="toast" id="toast"></div>

<script>
let AUTH = "";

document.getElementById("btnConnect").onclick = function() {
  AUTH = document.getElementById("authSecret").value;
  if (!AUTH) return toast("Ingresa la clave","error");
  loadUsers().then(function() {
    document.getElementById("connectStatus").innerHTML = "<div class=badge badge-active style=font-size:.8rem;padding:6px 12px>Conectado</div>";
    document.getElementById("usersCard").style.display = "block";
  }).catch(function() {
    document.getElementById("connectStatus").innerHTML = "<div class=badge badge-disabled style=font-size:.8rem;padding:6px 12px>Clave incorrecta</div>";
  });
};

document.getElementById("btnRefresh").onclick = loadUsers;
document.getElementById("btnNew").onclick = openCreateModal;
document.getElementById("btnCancel").onclick = closeModal;
document.getElementById("modal").onclick = function(e) { if (e.target === this) closeModal(); };
document.getElementById("userForm").onsubmit = handleSubmit;

async function api(method, path, body) {
  var headers = { "Content-Type": "application/json", "Authorization": "Bearer " + AUTH };
  var res = await fetch(path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  var data = await res.json();
  if (!res.ok && data.error) throw new Error(data.error);
  return data;
}

async function loadUsers() {
  try {
    var data = await api("GET", "/api/users");
    var users = data.data || [];
    document.getElementById("userCount").textContent = "(" + users.length + ")";
    document.getElementById("emptyState").style.display = users.length ? "none" : "block";
    var html = "";
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      html += "<tr>" +
        "<td><div style=font-weight:600>" + esc(u.email) + "</div></td>" +
        "<td>" + esc(u.displayName || "-") + "</td>" +
        "<td><span class=badge style=background:#FFF8DC;color:#8B4513>" + esc(u.role || "cajero") + "</span></td>" +
        "<td><span class=badge " + (u.disabled ? "badge-disabled" : "badge-active") + ">" + (u.disabled ? "Deshabilitado" : "Activo") + "</span>" +
        (u.emailVerified ? "<span class=badge badge-verified style=margin-left:4px>OK</span>" : "") + "</td>" +
        "<td style=font-size:.75rem;color:#8B7355>" + (u.created ? new Date(u.created).toLocaleDateString() : "-") + "</td>" +
        "<td>" +
        "<button class=btn btn-sm data-action=edit data-uid=" + u.uid + " data-email=" + esc(u.email) + " data-name=" + esc(u.displayName || "") + " data-disabled=" + u.disabled + " data-role=" + esc(u.role || "cajero") + ">Editar</button>" +
        "<button class=btn btn-sm btn-danger data-action=delete data-uid=" + u.uid + " data-email=" + esc(u.email) + ">Eliminar</button>" +
        "</td></tr>";
    }
    document.getElementById("usersTable").innerHTML = html;
  } catch (e) { toast(e.message, "error"); }
}

document.getElementById("usersTable").onclick = function(e) {
  var btn = e.target.closest("button");
  if (!btn) return;
  var action = btn.getAttribute("data-action");
  var uid = btn.getAttribute("data-uid");
  var email = btn.getAttribute("data-email");
  if (action === "edit") {
    var name = btn.getAttribute("data-name");
    var disabled = btn.getAttribute("data-disabled") === "true";
    var role = btn.getAttribute("data-role");
    openEditModal(uid, email, name, disabled, role);
  } else if (action === "delete") {
    del(uid, email);
  }
};

function openCreateModal() {
  document.getElementById("modalTitle").textContent = "Nuevo Usuario";
  document.getElementById("submitBtn").textContent = "Crear";
  document.getElementById("editUid").value = "";
  document.getElementById("fEmail").value = "";
  document.getElementById("fName").value = "";
  document.getElementById("fPassword").value = "";
  document.getElementById("fRole").value = "cajero";
  document.getElementById("fDisabled").value = "false";
  document.getElementById("pwdHint").textContent = "*";
  document.getElementById("fPassword").required = true;
  document.getElementById("modal").classList.add("show");
}

function openEditModal(uid, email, name, disabled, role) {
  document.getElementById("modalTitle").textContent = "Editar Usuario";
  document.getElementById("submitBtn").textContent = "Guardar";
  document.getElementById("editUid").value = uid;
  document.getElementById("fEmail").value = email;
  document.getElementById("fName").value = name;
  document.getElementById("fPassword").value = "";
  document.getElementById("fRole").value = role || "cajero";
  document.getElementById("fDisabled").value = String(disabled);
  document.getElementById("pwdHint").textContent = "(vacio = no cambiar)";
  document.getElementById("fPassword").required = false;
  document.getElementById("modal").classList.add("show");
}

function closeModal() { document.getElementById("modal").classList.remove("show"); }

async function handleSubmit(e) {
  e.preventDefault();
  var uid = document.getElementById("editUid").value;
  var body = {
    email: document.getElementById("fEmail").value,
    displayName: document.getElementById("fName").value,
    role: document.getElementById("fRole").value,
    disabled: document.getElementById("fDisabled").value === "true"
  };
  var pwd = document.getElementById("fPassword").value;
  if (pwd) body.password = pwd;
  try {
    if (uid) { await api("PATCH", "/api/users/" + uid, body); toast("Actualizado", "success"); }
    else { await api("POST", "/api/users", body); toast("Creado", "success"); }
    closeModal(); loadUsers();
  } catch (e) { toast(e.message, "error"); }
}

async function del(uid, email) {
  if (!confirm("Eliminar " + email + "?")) return;
  try { await api("DELETE", "/api/users/" + uid); toast("Eliminado", "success"); loadUsers(); }
  catch (e) { toast(e.message, "error"); }
}

function toast(msg, type) {
  var el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast " + (type || "") + " show";
  setTimeout(function() { el.classList.remove("show"); }, 3000);
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
</script></body></html>`;
