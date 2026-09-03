/* =========================================================
   SISTEMA DE CARTERA - SUPABASE (misma base de datos que Ventas)
   ========================================================= */
(function () {
  "use strict";
  if (window.__carteraAppLoaded) return;
  window.__carteraAppLoaded = true;

  // Mismo proyecto de Supabase que la app de Ventas (misma empresa, distinta área).
  const SUPABASE_URL = "https://jsyeczuhdjusbcmpiiyg.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5gFuPfsCqONtLc1G_gk-jQ_eUPK30zp";
  const { createClient } = window.supabase;
  const sbClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const LLAMADA_TYPES = ["Contestada", "No contestada", "Equivocada"];
  // Zonas predeterminadas del sistema de cartera.
  const ZONAS = ["San Marcos", "Caucasia", "Montelíbano", "La Apartada", "Buenavista"];
  const META_POR_DEFECTO = 500;
  let currentUser = null, currentProfile = null, calls = [], advisors = [], surveys = [], config = { color_principal: "#0ea5e9", logo_url: "" };

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents(); setTodayDefault(); showAuthView(); applyTheme();
    toggleWhatsappFields(); toggleCompromisoField(); toggleEncuestaFields();
    const { data: { session } } = await sbClient.auth.getSession();
    if (session?.user) await initializeSession(session.user);
    sbClient.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") { currentUser = null; currentProfile = null; calls = []; advisors = []; surveys = []; showAuthView(); return; }
      if (session?.user && event !== "INITIAL_SESSION") await initializeSession(session.user);
    });
  });

  function bindEvents() {
    id("login-form").addEventListener("submit", login); id("register-form").addEventListener("submit", registerAdvisor); id("call-form").addEventListener("submit", registerCall);
    id("btn-show-register").addEventListener("click", () => { id("auth-view").classList.add("hidden"); id("register-view").classList.remove("hidden"); });
    id("btn-back-login").addEventListener("click", showAuthView); id("btn-logout").addEventListener("click", logout);
    id("btn-menu").addEventListener("click", () => id("sidebar").classList.toggle("open")); id("btn-close-menu").addEventListener("click", closeSidebar);
    id("filtroAsesor").addEventListener("input", renderAdvisorTable);
    id("whatsappEnviado").addEventListener("change", toggleWhatsappFields);
    id("compromisoPago").addEventListener("change", toggleCompromisoField);
    id("incluirEncuesta").addEventListener("change", toggleEncuestaFields);
    ["filtroAdminTexto","filtroAsesorAdmin","filtroLlamadaAdmin","filtroCompromisoAdmin","filtroPagoAdmin","filtroZonaAdmin","filtroDesdeAdmin","filtroHastaAdmin"].forEach(x => { id(x).addEventListener("input", renderAdmin); id(x).addEventListener("change", renderAdmin); });
    id("btn-clear-filters").addEventListener("click", clearAdminFilters); id("btn-preview-report").addEventListener("click", () => previewReport()); id("btn-close-report-preview").addEventListener("click", closeReportPreview); id("btn-print-report").addEventListener("click", () => printReport()); id("btn-pdf-report").addEventListener("click", () => downloadPDF()); id("btn-excel-report").addEventListener("click", downloadExcel);
    id("btn-preview-advisor-summary").addEventListener("click", () => previewReport(buildAdvisorSummaryReportHTML)); id("btn-print-advisor-summary").addEventListener("click", () => printReport(buildAdvisorSummaryReportHTML)); id("btn-pdf-advisor-summary").addEventListener("click", () => downloadPDF(buildAdvisorSummaryReportHTML,"resumen-llamadas-por-asesor")); id("btn-excel-advisor-summary").addEventListener("click", downloadAdvisorSummaryExcel);
    id("admin-user-form").addEventListener("submit", saveAdminUser); id("btn-cancel-user-edit").addEventListener("click", resetUserForm);
    ["filtroEncuestaAsesor","filtroEncuestaDesde","filtroEncuestaHasta","filtroEncuestaTexto"].forEach(x => { if(id(x)){ id(x).addEventListener("input", renderSurveys); id(x).addEventListener("change", renderSurveys); }});
    id("btn-clear-survey-filters").addEventListener("click", clearSurveyFilters);
    id("btn-preview-survey-report").addEventListener("click", () => previewReport(buildSurveyReportHTML));
    id("btn-print-survey-report").addEventListener("click", () => printReport(buildSurveyReportHTML));
    id("btn-pdf-survey-report").addEventListener("click", () => downloadPDF(buildSurveyReportHTML,"reporte-encuestas-cartera"));
    id("btn-excel-survey-report").addEventListener("click", downloadSurveyExcel);
    id("config-form").addEventListener("submit", saveConfig); id("btn-remove-logo").addEventListener("click", removeLogo);
    id("btn-asesor-report").addEventListener("click", previewAdvisorReport); id("btn-asesor-print").addEventListener("click", printAdvisorReport); id("btn-asesor-pdf").addEventListener("click", downloadAdvisorPDF);
    id("btn-download-backup").addEventListener("click", downloadBackup);
  }

  function toggleWhatsappFields(){const on=id("whatsappEnviado").value==="true";id("whatsappMensajeGroup").classList.toggle("hidden",!on);id("whatsappRespuestaGroup").classList.toggle("hidden",!on);}
  function toggleCompromisoField(){const on=id("compromisoPago").value==="true";id("fechaCompromisoGroup").classList.toggle("hidden",!on);}
  function toggleEncuestaFields(){const on=id("incluirEncuesta").checked;id("encuesta-fields").classList.toggle("hidden",!on);}

  async function login(e) { e.preventDefault(); const email=value("login-email"), password=id("login-password").value; setButtonBusy(e.submitter,true,"Ingresando..."); const {data,error}=await sbClient.auth.signInWithPassword({email,password}); setButtonBusy(e.submitter,false,"Ingresar"); if(error){showToast(authError(error),true);return;} await initializeSession(data.user); }

  async function registerAdvisor(e) {
    e.preventDefault(); const password=id("reg-password").value, confirm=id("reg-password-confirm").value;
    if(password!==confirm){showToast("Las contraseñas no coinciden.",true);return;} if(password.length<6){showToast("La contraseña debe tener mínimo 6 caracteres.",true);return;}
    const payload={area:"cartera",nombre:value("reg-nombre"),apellido:value("reg-apellido"),documento:value("reg-documento"),telefono:value("reg-telefono"),zona:"",rol:"asesor"};
    setButtonBusy(e.submitter,true,"Registrando..."); const {data,error}=await sbClient.auth.signUp({email:value("reg-email"),password,options:{data:payload}}); setButtonBusy(e.submitter,false,"Registrar asesor");
    if(error){showToast(authError(error),true);return;} id("register-form").reset(); if(data.session){showToast("Asesor registrado correctamente.");await initializeSession(data.user);}else{showToast("Registro creado. Revisa el correo para confirmar la cuenta.");showAuthView();}
  }

  async function initializeSession(user) {
    currentUser=user;
    const {data:profile,error}=await sbClient.from("perfilescr").select("*").eq("id",user.id).single();
    if(error){console.error(error);await sbClient.auth.signOut();showToast("No fue posible cargar tu perfil. Ejecuta el SQL de Cartera.",true);return;}
    if(profile.activo === false){await sbClient.auth.signOut();showToast("Tu usuario está inhabilitado. Contacta al administrador.",true);return;}
    currentProfile=profile; await loadConfig(); updateSessionHeader(); buildSidebar();
    if(profile.rol==="administrador"){await loadAdminData();showView("admin-dashboard");} else {await loadAdvisorData();showView("vista-asesor");}
  }

  async function loadConfig(){const {data}=await sbClient.from("configuracioncr").select("color_principal,logo_url").eq("id",1).maybeSingle(); if(data) config=data; applyTheme(); renderConfig();}

  async function loadAdvisorData(){const {data,error}=await sbClient.from("llamadascr").select("*").eq("asesor_id",currentUser.id).order("fecha_llamada",{ascending:false}).order("id",{ascending:false}); if(error){console.error(error);showToast("No fue posible cargar tus llamadas.",true);return;} calls=data||[]; applyAdvisorProfile();renderAdvisorTable();updateAdvisorDashboard();renderSeguimientoAsesor();}

  async function loadAdminData(){
    const [cr,ar,er]=await Promise.all([
      sbClient.from("llamadascr").select(`*, perfilescr:asesor_id (id,nombre,apellido,zona,email,activo)`).order("fecha_llamada",{ascending:false}).order("id",{ascending:false}),
      sbClient.from("perfilescr").select("*").eq("rol","asesor").order("nombre",{ascending:true}).order("apellido",{ascending:true}),
      sbClient.from("encuestascr").select("*").order("id",{ascending:false})
    ]);
    if(cr.error){console.error(cr.error);showToast("No fue posible cargar las llamadas.",true);return;} if(ar.error){console.error(ar.error);showToast("No fue posible cargar los asesores.",true);return;}
    if(er.error){console.error(er.error);showToast("No fue posible cargar las encuestas. Ejecuta la estructura SQL de Cartera.",true);return;}
    calls=cr.data||[]; advisors=ar.data||[]; surveys=er.data||[]; populateAdminFilters(); populateSurveyFilters(); renderAdmin(); renderSurveys(); renderUsers(); updateAdminDashboard(); renderConfig();
  }

  async function registerCall(e){
    e.preventDefault(); if(!currentUser||!currentProfile){showToast("Tu sesión no está disponible.",true);return;}
    const whatsapp=id("whatsappEnviado").value==="true", compromiso=id("compromisoPago").value==="true", pago=id("pago").value==="true";
    if(compromiso && !id("fechaCompromiso").value){showToast("Selecciona la fecha del compromiso de pago.",true);return;}
    const zonaSeleccionada=value("zona"); if(!ZONAS.includes(zonaSeleccionada)){showToast("Selecciona una zona válida de la lista.",true);return;} const row={asesor_id:currentUser.id,cliente:value("cliente"),llamada:value("tipoLlamada"),zona:zonaSeleccionada,whatsapp_enviado:whatsapp,whatsapp_mensaje:whatsapp?(value("whatsappMensaje")||null):null,whatsapp_respuesta:whatsapp?(value("whatsappRespuesta")||null):null,compromiso_pago:compromiso,fecha_compromiso:compromiso?id("fechaCompromiso").value:null,pago:pago,observaciones:value("observaciones")||null,fecha_llamada:id("fechaLlamada").value};
    if(!row.cliente||!row.llamada||!row.zona||!row.fecha_llamada){showToast("Completa todos los campos obligatorios.",true);return;}
    const {data,error}=await sbClient.from("llamadascr").insert(row).select().single(); if(error){console.error(error);showToast(error.message||"No fue posible registrar la llamada.",true);return;}
    if(id("incluirEncuesta").checked){
      const enc={llamada_id:data.id,asesor_id:currentUser.id,codigo_usuario:value("encCodigoUsuario"),calificacion_servicio:value("encServicio"),observacion_servicio:value("encServicioObs")||null,calificacion_tecnica:value("encTecnica"),observacion_tecnica:value("encTecnicaObs")||null,calificacion_administrativa:value("encAdministrativa"),observacion_administrativa:value("encAdministrativaObs")||null,agilidad_averias:value("encAverias"),recomendaria:value("encRecomendaria"),recomendacion_felicitacion:value("encRecomendacion")||null};
      if(enc.codigo_usuario&&enc.calificacion_servicio&&enc.calificacion_tecnica&&enc.calificacion_administrativa&&enc.agilidad_averias&&enc.recomendaria){
        const {error:encError}=await sbClient.from("encuestascr").insert(enc);
        if(encError){console.error(encError);showToast("La llamada se registró, pero la encuesta no se pudo guardar.",true);}
      } else { showToast("La llamada se registró. La encuesta no se guardó: faltaron campos obligatorios.",true); }
    }
    e.target.reset();applyAdvisorProfile();setTodayDefault();toggleWhatsappFields();toggleCompromisoField();toggleEncuestaFields();calls.unshift(data);renderAdvisorTable();updateAdvisorDashboard();renderSeguimientoAsesor();showToast("Llamada registrada correctamente.");
  }

  async function setPago(callId,val){
    if(!currentProfile||currentProfile.rol!=="administrador")return;
    const {data,error}=await sbClient.from("llamadascr").update({pago:val}).eq("id",callId).select(`*,perfilescr:asesor_id (id,nombre,apellido,zona,email,activo)`).single();
    if(error){showToast("No fue posible actualizar el pago.",true);return;} updateCallLocal(data); showToast(val?"Marcado como pagado.":"Marcado como no pagado.");
  }
  function updateCallLocal(data){const i=calls.findIndex(x=>x.id===data.id);if(i>=0)calls[i]=data;renderAdmin();updateAdminDashboard();}
  async function deleteCall(callId){if(!confirm("¿Eliminar definitivamente esta llamada? Esta acción no se puede deshacer."))return;const {error}=await sbClient.from("llamadascr").delete().eq("id",callId);if(error){showToast("No fue posible eliminar la llamada. Verifica las políticas RLS.",true);return;}calls=calls.filter(x=>x.id!==callId);renderAdmin();updateAdminDashboard();showToast("Llamada eliminada.");}

  function buildSidebar(){const nav=id("sidebar-nav");const admin=currentProfile?.rol==="administrador";const items=admin?[ ["admin-dashboard","▦","Dashboard"],["vista-admin","▤","Llamadas"],["vista-usuarios","♙","Asesores"],["vista-configuracion","⚙","Configuración"],["vista-respaldo","⭳","Respaldo"] ]:[["vista-asesor","▦","Mi dashboard"],["vista-asesor","＋","Registrar llamada"],["vista-asesor","▤","Mis llamadas"]];nav.innerHTML=items.map(([target,icon,label])=>`<button class="nav-item" type="button" data-target="${target}" data-anchor="${target==='vista-asesor'?label:''}"><span>${icon}</span>${label}</button>`).join("");nav.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>{showView(b.dataset.target);if(b.dataset.anchor==="Registrar llamada")id("asesor-form-section").scrollIntoView({behavior:"smooth"});if(b.dataset.anchor==="Mis llamadas")document.querySelector("#vista-asesor .table-card").scrollIntoView({behavior:"smooth"});closeSidebar();}));}
  function closeSidebar(){id("sidebar").classList.remove("open");}

  function updateSessionHeader(){const name=[currentProfile?.nombre,currentProfile?.apellido].filter(Boolean).join(" ")||"Usuario", role=currentProfile?.rol==="administrador"?"Administrador":"Asesor";id("user-name").textContent=name;id("user-role").textContent=role;id("user-avatar").textContent=name.charAt(0).toUpperCase();id("sidebar-user-name").textContent=name;id("sidebar-user-role").textContent=role;id("session-area").classList.remove("hidden");id("btn-menu").classList.remove("hidden");id("sidebar").classList.remove("hidden");}
  function applyAdvisorProfile(){const select=id("zona");if(select){select.innerHTML=`<option value="">Seleccione la zona...</option>`+ZONAS.map(z=>`<option value="${escapeHTML(z)}">${escapeHTML(z)}</option>`).join("");select.value="";}id("asesor-zone-badge").textContent="Zona de trabajo: cualquier zona";id("asesor-welcome").textContent="Registra llamadas y selecciona la zona correspondiente en cada gestión.";}

  function renderAdvisorTable(){const tabla=id("tabla-asesor"),filtro=value("filtroAsesor").toLowerCase(),filtered=calls.filter(c=>[c.cliente,c.llamada,c.zona,c.observaciones].join(" ").toLowerCase().includes(filtro));tabla.innerHTML=filtered.length?filtered.map(c=>`<tr><td>#${c.id}</td><td>${escapeHTML(c.cliente)}</td><td>${llamadaBadge(c.llamada)}</td><td>${escapeHTML(c.zona)}</td><td>${whatsappBadge(c)}</td><td>${compromisoCell(c)}</td><td>${pagoBadge(c.pago)}</td><td>${formatDate(c.fecha_llamada)}</td></tr>`).join(""):`<tr class="empty-row"><td colspan="8">${calls.length?"No se encontraron llamadas.":"No hay llamadas registradas."}</td></tr>`;updateAdvisorStats();}
  function updateAdvisorStats(){const total=calls.length,contestadas=calls.filter(c=>c.llamada==="Contestada").length,no=calls.filter(c=>c.llamada==="No contestada").length,pagos=calls.filter(c=>c.pago).length,compromisos=calls.filter(c=>c.compromiso_pago).length;id("asesor-total-count").textContent=total;id("asesor-contestadas-count").textContent=contestadas;id("asesor-nocontestadas-count").textContent=no;id("asesor-pagos-count").textContent=pagos;id("asesor-compromisos-count").textContent=compromisos;const meta=metaDe(currentProfile),pct=metaPct(total,meta);setText("asesor-meta-count",meta);setText("asesor-meta-pct",`${pct}%`);const bar=id("asesor-meta-bar");if(bar)bar.style.width=`${Math.min(100,pct)}%`;}
  function metaDe(p){const n=Number(p?.meta_llamadas);return Number.isFinite(n)&&n>0?n:META_POR_DEFECTO;}
  function metaPct(hechas,meta){return meta>0?Math.round(hechas/meta*100):0;}
  function updateAdvisorDashboard(){updateAdvisorStats();}

  function renderAdmin(){const filtered=getFilteredAdminCalls();const summaryBody=id("tabla-admin");const detailBody=id("tabla-admin-detail");const by={};filtered.forEach(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—";const k=c.asesor_id||name;if(!by[k])by[k]={name,total:0,contestadas:0,no:0,whatsapp:0,compromisos:0,pagos:0,zones:new Set()};const g=by[k];g.total++;if(c.llamada==="Contestada")g.contestadas++;if(c.llamada==="No contestada")g.no++;if(c.whatsapp_enviado)g.whatsapp++;if(c.compromiso_pago)g.compromisos++;if(c.pago)g.pagos++;if(c.zona)g.zones.add(c.zona);});const rows=Object.values(by).sort((a,b)=>b.total-a.total);if(summaryBody)summaryBody.innerHTML=rows.length?rows.map(g=>`<tr><td><strong>${escapeHTML(g.name)}</strong></td><td>${g.total}</td><td><span class="metric-pill metric-ok">${g.contestadas}</span></td><td><span class="metric-pill metric-no">${g.no}</span></td><td><span class="metric-pill metric-wa">${g.whatsapp}</span></td><td>${g.compromisos}</td><td>${g.pagos}</td><td>${escapeHTML([...g.zones].join(", ")||"—")}</td></tr>`).join(""):'<tr class="empty-row"><td colspan="8">No hay llamadas con los filtros seleccionados.</td></tr>';if(detailBody)detailBody.innerHTML=filtered.length?filtered.map(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||"—";return `<tr><td>#${c.id}</td><td>${escapeHTML(name)}</td><td>${escapeHTML(c.cliente)}</td><td>${llamadaBadge(c.llamada)}</td><td>${escapeHTML(c.zona)}</td><td>${whatsappBadge(c)}</td><td>${compromisoCell(c)}</td><td class="action-cell">${pagoBadge(c.pago)}<button class="btn-small" onclick="setPago(${c.id},${!c.pago})">${c.pago?"Quitar pago":"Marcar pago"}</button></td><td>${formatDate(c.fecha_llamada)}</td><td class="action-cell"><button class="btn-delete" onclick="deleteCall(${c.id})">Eliminar</button></td></tr>`;}).join(""):'<tr class="empty-row"><td colspan="10">No hay llamadas registradas.</td></tr>';setText("admin-result-count",`${filtered.length} llamada${filtered.length===1?"":"s"}`);renderSeguimientoAdmin();}
   function getFilteredAdminCalls(){const text=value("filtroAdminTexto").toLowerCase(),asesor=id("filtroAsesorAdmin").value,llamada=id("filtroLlamadaAdmin").value,compromiso=id("filtroCompromisoAdmin").value,pago=id("filtroPagoAdmin").value,zona=id("filtroZonaAdmin").value,from=id("filtroDesdeAdmin").value,to=id("filtroHastaAdmin").value;return calls.filter(c=>{const a=c.perfilescr||{},search=[a.nombre,a.apellido,a.email,c.cliente,c.zona,c.observaciones,c.llamada].join(" ").toLowerCase();return(!text||search.includes(text))&&(!asesor||c.asesor_id===asesor)&&(!llamada||c.llamada===llamada)&&(!compromiso||String(c.compromiso_pago)===compromiso)&&(!pago||String(c.pago)===pago)&&(!zona||c.zona===zona)&&(!from||c.fecha_llamada>=from)&&(!to||c.fecha_llamada<=to);});}
  function populateAdminFilters(){const as=id("filtroAsesorAdmin"),zone=id("filtroZonaAdmin"),aVal=as.value,zVal=zone.value;as.innerHTML='<option value="">Todos los asesores</option>'+advisors.map(a=>`<option value="${a.id}">${escapeHTML([a.nombre,a.apellido].filter(Boolean).join(" ")||a.email)}</option>`).join("");as.value=aVal;zone.innerHTML='<option value="">Todas las zonas</option>'+ZONAS.map(z=>`<option>${escapeHTML(z)}</option>`).join("");zone.value=zVal;}

  function updateAdminDashboard(){const total=calls.length,contestadas=calls.filter(c=>c.llamada==="Contestada").length,no=calls.filter(c=>c.llamada==="No contestada").length,compromisos=calls.filter(c=>c.compromiso_pago).length,pagos=calls.filter(c=>c.pago).length;setText("dash-total",total);setText("dash-contestadas",contestadas);setText("dash-nocontestadas",no);setText("dash-compromisos",compromisos);setText("dash-pagos",pagos);const now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`,monthly=calls.filter(c=>c.fecha_llamada?.startsWith(ym));id("dash-goals-list").innerHTML=advisors.map(a=>{const n=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email,count=monthly.filter(c=>c.asesor_id===a.id).length,meta=metaDe(a),pct=metaPct(count,meta);return `<div class="goal-chart-row"><div class="goal-chart-head"><strong>${escapeHTML(n)}</strong><span>${count} de ${meta} llamadas · ${pct}%</span></div><div class="goal-track"><i style="width:${Math.min(100,pct)}%"></i></div></div>`;}).join("")||'<p class="muted">No hay asesores registrados.</p>';const counts=LLAMADA_TYPES.map(t=>({t,n:monthly.filter(c=>c.llamada===t).length}));const max=Math.max(1,...counts.map(x=>x.n));id("dash-services-list").innerHTML=counts.map(x=>`<div class="mini-bar-row"><span>${x.t}</span><div><i style="width:${x.n/max*100}%"></i></div><strong>${x.n}</strong></div>`).join("");}

  function renderUsers(){const tbody=id("tabla-usuarios");if(!tbody)return;tbody.innerHTML=advisors.map(a=>{const name=[a.nombre,a.apellido].filter(Boolean).join(" ")||"—";const meta=metaDe(a),hechas=calls.filter(c=>c.asesor_id===a.id).length,pct=metaPct(hechas,meta);return `<tr><td><strong>${escapeHTML(name)}</strong></td><td>${escapeHTML(a.email||"—")}</td><td>${meta}</td><td>${hechas}</td><td><div class="mini-progress"><span style="width:${Math.min(100,pct)}%"></span></div><small>${pct}%</small></td><td>${a.activo===false?'<span class="badge badge-disabled">Inhabilitado</span>':'<span class="badge badge-active">Activo</span>'}</td><td class="action-cell"><button class="btn-small" onclick="editAdvisor('${a.id}')">Editar</button><button class="btn-small" onclick="toggleAdvisor('${a.id}',${a.activo!==false})">${a.activo===false?"Habilitar":"Inhabilitar"}</button><button class="btn-delete" onclick="deleteAdvisor('${a.id}')">Eliminar</button></td></tr>`;}).join("")||'<tr class="empty-row"><td colspan="7">No hay asesores registrados.</td></tr>';}

  async function saveAdminUser(e){e.preventDefault();const idUser=id("admin-user-id").value;const body={nombre:value("admin-user-nombre"),apellido:value("admin-user-apellido"),documento:value("admin-user-documento"),telefono:value("admin-user-telefono"),zona:"",email:value("admin-user-email"),meta_llamadas:Math.max(0,parseInt(id("admin-user-meta").value,10)||META_POR_DEFECTO)};if(!idUser){const password=id("admin-user-password").value;if(password.length<6){showToast("La contraseña debe tener mínimo 6 caracteres.",true);return;}const {data,error}=await fetchAdminFunction("create",{...body,password});if(error){showToast(error,true);return;}showToast("Asesor creado correctamente.");resetUserForm();await loadAdminData();return;}const result=await fetchAdminFunction("update",{user_id:idUser,...body});if(result.error){showToast(result.error,true);return;}showToast("Asesor actualizado.");resetUserForm();await loadAdminData();}
  async function fetchAdminFunction(action,payload){const {data:{session}}=await sbClient.auth.getSession();if(!session)return{error:"Sesión no disponible."};try{const r=await fetch(`${SUPABASE_URL}/functions/v1/admin-users-cr`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload})});const j=await r.json().catch(()=>({}));return r.ok?{data:j}:{error:j.error||`Error ${r.status}`};}catch(e){return{error:"No se pudo contactar la función de administración. Debes desplegar supabase/functions/admin-users-cr."};}}
  function editAdvisor(uid){const a=advisors.find(x=>x.id===uid);if(!a)return;id("admin-user-id").value=a.id;["nombre","apellido","documento","telefono","email"].forEach(k=>id(`admin-user-${k}`).value=a[k]||"");id("admin-user-meta").value=metaDe(a);id("admin-user-password").value="";id("btn-save-user").textContent="Actualizar asesor";id("btn-cancel-user-edit").classList.remove("hidden");document.getElementById("vista-usuarios").scrollIntoView({behavior:"smooth"});}
  function resetUserForm(){id("admin-user-form").reset();id("admin-user-id").value="";id("admin-user-meta").value=META_POR_DEFECTO;id("btn-save-user").textContent="Crear asesor";id("btn-cancel-user-edit").classList.add("hidden");}
  async function toggleAdvisor(uid,active){const {error}=await sbClient.from("perfilescr").update({activo:!active}).eq("id",uid);if(error){showToast(error.message,true);return;}showToast(active?"Asesor inhabilitado.":"Asesor habilitado.");await loadAdminData();}
  async function deleteAdvisor(uid){const a=advisors.find(x=>x.id===uid);if(!a)return;if(!confirm(`¿Eliminar a ${[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email}? Solo se podrá eliminar si no tiene llamadas registradas.`))return;const result=await fetchAdminFunction("delete",{user_id:uid});if(result.error){showToast(result.error,true);return;}showToast("Asesor eliminado.");await loadAdminData();}

  async function saveConfig(e){e.preventDefault();let logo=config.logo_url||"";const file=id("config-logo").files[0];if(file){if(file.size>2*1024*1024){showToast("La imagen debe pesar máximo 2 MB.",true);return;}logo=await fileToDataURL(file);}const color=id("config-color").value;const {error}=await sbClient.from("configuracioncr").upsert({id:1,color_principal:color,logo_url:logo,updated_by:currentUser.id},{onConflict:"id"});if(error){showToast(error.message,true);return;}config={color_principal:color,logo_url:logo};applyTheme();renderConfig();showToast("Configuración guardada.");}
  async function removeLogo(){const {error}=await sbClient.from("configuracioncr").upsert({id:1,color_principal:config.color_principal,logo_url:"",updated_by:currentUser.id},{onConflict:"id"});if(error){showToast(error.message,true);return;}config.logo_url="";renderConfig();showToast("Imagen retirada del reporte.");}
  function renderConfig(){id("config-color").value=config.color_principal||"#0ea5e9";id("logo-preview").innerHTML=config.logo_url?`<img src="${config.logo_url}" alt="Logo de empresa">`:'<span>LOGO</span>';}
  function applyTheme(){document.documentElement.style.setProperty("--purple-primary",config.color_principal||"#0ea5e9");}

  function clearAdminFilters(){["filtroAdminTexto","filtroAsesorAdmin","filtroLlamadaAdmin","filtroCompromisoAdmin","filtroPagoAdmin","filtroZonaAdmin","filtroDesdeAdmin","filtroHastaAdmin"].forEach(x=>id(x).value="");renderAdmin();}

  function groupByClient(list){const map={};list.forEach(c=>{if(!map[c.cliente])map[c.cliente]={total:0,contestadas:0,nocontestadas:0,compromisos:0,pagos:0,asesores:new Set()};const g=map[c.cliente];g.total++;if(c.llamada==="Contestada")g.contestadas++;if(c.llamada==="No contestada")g.nocontestadas++;if(c.compromiso_pago)g.compromisos++;if(c.pago)g.pagos++;const a=c.perfilescr;if(a)g.asesores.add([a.nombre,a.apellido].filter(Boolean).join(" ")||a.email);});return map;}
  function renderSeguimientoAsesor(){const now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`,monthly=calls.filter(c=>c.fecha_llamada?.startsWith(ym));const map=groupByClient(monthly);const rows=Object.entries(map).sort((a,b)=>b[1].total-a[1].total);const tbody=id("tabla-seguimiento-asesor");if(!tbody)return;tbody.innerHTML=rows.length?rows.map(([cliente,g])=>`<tr><td>${escapeHTML(cliente)}</td><td>${g.total}</td><td>${g.contestadas}</td><td>${g.nocontestadas}</td><td>${g.compromisos}</td><td>${g.pagos}</td></tr>`).join(""):'<tr class="empty-row"><td colspan="6">No hay llamadas este mes.</td></tr>';}
  function renderSeguimientoAdmin(){const filtered=getFilteredAdminCalls();const map=groupByClient(filtered);const rows=Object.entries(map).sort((a,b)=>b[1].total-a[1].total);const tbody=id("tabla-seguimiento-admin");if(!tbody)return;tbody.innerHTML=rows.length?rows.map(([cliente,g])=>`<tr><td>${escapeHTML(cliente)}</td><td>${g.total}</td><td>${g.contestadas}</td><td>${g.nocontestadas}</td><td>${g.compromisos}</td><td>${g.pagos}</td><td>${escapeHTML([...g.asesores].join(", ")||"—")}</td></tr>`).join(""):'<tr class="empty-row"><td colspan="7">No hay llamadas con los filtros seleccionados.</td></tr>';}

  function metasResumen(list){return advisors.map(a=>{const nombre=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—",meta=metaDe(a),hechas=list.filter(c=>c.asesor_id===a.id).length;return {nombre,meta,hechas,pct:metaPct(hechas,meta),pendientes:Math.max(0,meta-hechas)};}).sort((x,y)=>y.pct-x.pct);}
  function metasTablaHTML(list){const filas=metasResumen(list);if(!filas.length)return "";const tot=filas.reduce((acc,f)=>({meta:acc.meta+f.meta,hechas:acc.hechas+f.hechas}),{meta:0,hechas:0});return `<section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">METAS</span><h2>Cumplimiento de metas por asesor</h2></div><strong>${metaPct(tot.hechas,tot.meta)}% global</strong></div><div class="goal-chart print-goal-chart">${filas.map(f=>`<div class="goal-chart-row"><div class="goal-chart-head"><strong>${escapeHTML(f.nombre)}</strong><span>${f.hechas} / ${f.meta} llamadas · ${f.pct}%</span></div><div class="goal-track"><i style="width:${Math.min(100,f.pct)}%"></i></div></div>`).join("")}</div><div class="print-table-scroll"><table><thead><tr><th>Asesor</th><th>Meta</th><th>Llamadas realizadas</th><th>Pendientes</th><th>% de cumplimiento</th></tr></thead><tbody>${filas.map(f=>`<tr><td>${escapeHTML(f.nombre)}</td><td>${f.meta}</td><td>${f.hechas}</td><td>${f.pendientes}</td><td>${f.pct}%</td></tr>`).join("")}<tr><td><strong>TOTAL</strong></td><td><strong>${tot.meta}</strong></td><td><strong>${tot.hechas}</strong></td><td><strong>${Math.max(0,tot.meta-tot.hechas)}</strong></td><td><strong>${metaPct(tot.hechas,tot.meta)}%</strong></td></tr></tbody></table></div></section>`;}

  function advisorCallSummary(list){
    const groups={};
    (list||[]).forEach(c=>{
      const a=c.perfilescr||{};
      const name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Sin asesor";
      const key=c.asesor_id||name;
      if(!groups[key]) groups[key]={name,total:0,contestadas:0,no:0,equivocadas:0,whatsapp:0,compromisos:0,pagos:0,zones:new Set()};
      const g=groups[key];
      g.total++;
      if(c.llamada==="Contestada") g.contestadas++;
      if(c.llamada==="No contestada") g.no++;
      if(c.llamada==="Equivocada") g.equivocadas++;
      if(c.whatsapp_enviado) g.whatsapp++;
      if(c.compromiso_pago) g.compromisos++;
      if(c.pago) g.pagos++;
      if(c.zona) g.zones.add(c.zona);
    });
    return Object.values(groups).sort((a,b)=>b.total-a.total);
  }

  function buildReportHTML(){const filtered=getFilteredAdminCalls(),total=filtered.length,contestadas=filtered.filter(c=>c.llamada==="Contestada").length,no=filtered.filter(c=>c.llamada==="No contestada").length,equivocadas=filtered.filter(c=>c.llamada==="Equivocada").length,compromisos=filtered.filter(c=>c.compromiso_pago).length,pagos=filtered.filter(c=>c.pago).length,pct=n=>total?Math.round(n/total*100):0;
    const metaTotal=advisors.reduce((acc,a)=>acc+metaDe(a),0);
    const desde=value("filtroDesdeAdmin"),hasta=value("filtroHastaAdmin"),period=desde||hasta?`${desde?formatDate(desde):"Inicio"} – ${hasta?formatDate(hasta):"Actual"}`:"Todos los periodos";
    const rows=advisorCallSummary(filtered).map(g=>`<tr><td><strong>${escapeHTML(g.name)}</strong></td><td>${g.total}</td><td>${g.contestadas}</td><td>${g.no}</td><td>${g.whatsapp}</td><td>${g.compromisos}</td><td>${g.pagos}</td><td>${escapeHTML([...g.zones].join(", ")||"—")}</td></tr>`).join("");
    return `<div class="print-report-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">REPORTE DE CARTERA</span><h1>Llamadas de cobro</h1><p>Periodo: <strong>${escapeHTML(period)}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total llamadas</span><strong>${total}</strong></div><div class="print-summary-card"><span>Contestadas</span><strong>${contestadas}</strong></div><div class="print-summary-card"><span>Compromisos</span><strong>${compromisos}</strong></div><div class="print-summary-card"><span>Pagos</span><strong>${pagos}</strong></div><div class="print-summary-card"><span>Meta total</span><strong>${metaTotal}</strong></div><div class="print-summary-card"><span>% de la meta</span><strong>${metaPct(total,metaTotal)}%</strong></div></div><section class="print-charts"><div class="print-chart-card"><h2>Tipo de llamada</h2><div class="print-donut" style="--first:${pct(contestadas)*3.6}deg"><div class="print-donut-center"><strong>${total}</strong><span>total</span></div></div><div class="print-legend"><span>Contestada <strong>${pct(contestadas)}%</strong></span><span>No contestada <strong>${pct(no)}%</strong></span><span>Equivocada <strong>${pct(equivocadas)}%</strong></span></div></div><div class="print-chart-card"><h2>Compromisos y pagos</h2><div class="print-donut" style="--first:${pct(pagos)*3.6}deg"><div class="print-donut-center"><strong>${pct(pagos)}%</strong><span>pagaron</span></div></div><div class="print-legend"><span>Compromisos <strong>${pct(compromisos)}%</strong></span><span>Pagos <strong>${pct(pagos)}%</strong></span></div></div></section>${metasTablaHTML(filtered)}<section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">RESUMEN</span><h2>Llamadas por asesor</h2></div><strong>${total} resultado${total===1?"":"s"}</strong></div><div class="print-table-scroll"><table><thead><tr><th>Asesor</th><th>Total</th><th>Contestadas</th><th>No contestadas</th><th>WhatsApp</th><th>Compromisos</th><th>Pagos</th><th>Zonas gestionadas</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="print-empty-row">No hay registros.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function previewReport(builder=buildReportHTML){const modal=id("report-preview-modal"),content=id("report-preview-content");if(!modal||!content){showToast("No se encontró el visor de reportes.",true);return;}try{content.innerHTML=builder();modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");document.body.classList.add("report-preview-open");}catch(e){console.error(e);showToast("No fue posible preparar la vista previa.",true);}}
  function closeReportPreview(){const modal=id("report-preview-modal");if(!modal)return;modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");document.body.classList.remove("report-preview-open");}
  function printReport(builder=buildReportHTML){try{const html=builder();const w=window.open("","_blank","width=1200,height=850");if(!w){showToast("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.",true);return;}const css=document.querySelector('link[href*="styles.css"]');w.document.open();w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de cartera</title>${css?`<link rel="stylesheet" href="${css.href}">`:""}<style>body{margin:0;background:#fff;color:#252334}.print-report-sheet{display:block!important;max-width:none!important;box-shadow:none!important}.print-table-scroll{overflow:visible!important} @page{size:A4 landscape;margin:10mm}</style></head><body>${html}</body></html>`);w.document.close();w.focus();setTimeout(()=>{w.print();setTimeout(()=>w.close(),700);},500);}catch(e){console.error(e);showToast("No fue posible abrir la impresión.",true);}}
  async function downloadPDF(builder=buildReportHTML,filePrefix="reporte-cartera"){const area=id("print-report");if(!area){showToast("No se encontró el área de reporte.",true);return;}if(!window.html2canvas||!window.jspdf?.jsPDF){showToast("No se cargaron los componentes necesarios para PDF. Verifica tu conexión a internet y recarga la página.",true);return;}area.innerHTML=builder();area.classList.add("pdf-rendering");try{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const images=[...area.querySelectorAll("img")];await Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=img.onerror=r;})));const canvas=await html2canvas(area,{scale:2,useCORS:true,allowTaint:false,backgroundColor:"#ffffff",logging:false});const {jsPDF}=window.jspdf;const pdf=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});const pageW=297,pageH=210,margin=8,imgW=pageW-margin*2,pxPerPage=canvas.width*(pageH-margin*2)/imgW;let sourceY=0;while(sourceY<canvas.height){const h=Math.min(pxPerPage,canvas.height-sourceY);const pageCanvas=document.createElement("canvas");pageCanvas.width=canvas.width;pageCanvas.height=h;pageCanvas.getContext("2d").drawImage(canvas,0,sourceY,canvas.width,h,0,0,canvas.width,h);if(sourceY>0)pdf.addPage();pdf.addImage(pageCanvas.toDataURL("image/jpeg",0.95),"JPEG",margin,margin,imgW,h*imgW/canvas.width);sourceY+=h;}pdf.save(`${filePrefix}-${new Date().toISOString().slice(0,10)}.pdf`);showToast("PDF descargado correctamente.");}catch(e){console.error(e);showToast("No fue posible generar el PDF. Abre la consola del navegador para ver el detalle.",true);}finally{area.classList.remove("pdf-rendering");}}

  function buildAdvisorSummaryReportHTML(){
    const filtered=getFilteredAdminCalls(), groups={};
    filtered.forEach(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Sin asesor";const key=c.asesor_id||name;if(!groups[key])groups[key]={nombre:name,total:0,contestadas:0,nocontestadas:0,whatsapp:0,compromisos:0,pagos:0,zones:new Set()};const g=groups[key];g.total++;if(c.llamada==="Contestada")g.contestadas++;if(c.llamada==="No contestada")g.nocontestadas++;if(c.whatsapp_enviado)g.whatsapp++;if(c.compromiso_pago)g.compromisos++;if(c.pago)g.pagos++;if(c.zona)g.zones.add(c.zona);});
    const rows=Object.values(groups).map(g=>`<tr><td><strong>${escapeHTML(g.nombre)}</strong></td><td>${g.total}</td><td>${g.contestadas}</td><td>${g.nocontestadas}</td><td>${g.whatsapp}</td><td>${g.compromisos}</td><td>${g.pagos}</td><td>${escapeHTML([...g.zones].join(", ")||"—")}</td></tr>`).join("");
    const total=filtered.length;return `<div class="print-report-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">RESUMEN DE LLAMADAS</span><h1>Llamadas por asesor</h1><p>Periodo: <strong>${escapeHTML(value("filtroDesdeAdmin")||value("filtroHastaAdmin")?`${value("filtroDesdeAdmin")?formatDate(value("filtroDesdeAdmin")):"Inicio"} – ${value("filtroHastaAdmin")?formatDate(value("filtroHastaAdmin")):"Actual"}`:"Todos los periodos")}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total llamadas</span><strong>${total}</strong></div><div class="print-summary-card"><span>Asesores</span><strong>${Object.keys(groups).length}</strong></div><div class="print-summary-card"><span>Contestadas</span><strong>${filtered.filter(c=>c.llamada==="Contestada").length}</strong></div><div class="print-summary-card"><span>No contestadas</span><strong>${filtered.filter(c=>c.llamada==="No contestada").length}</strong></div></div><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">DETALLE AGRUPADO</span><h2>Resumen de llamadas por asesor</h2></div><strong>${Object.keys(groups).length} asesor${Object.keys(groups).length===1?"":"es"}</strong></div><div class="print-table-scroll"><table><thead><tr><th>Asesor</th><th>Total</th><th>Contestadas</th><th>No contestadas</th><th>WhatsApp</th><th>Compromisos</th><th>Pagos</th><th>Zonas gestionadas</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="print-empty-row">No hay llamadas para los filtros seleccionados.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function downloadAdvisorSummaryExcel(){try{if(!window.XLSX){showToast("No se pudo cargar el módulo de Excel.",true);return;}const filtered=getFilteredAdminCalls(),groups={};filtered.forEach(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Sin asesor";const key=c.asesor_id||name;if(!groups[key])groups[key]={Asesor:name,Total:0,Contestadas:0,"No contestadas":0,WhatsApp:0,Compromisos:0,Pagos:0,Zonas:new Set()};const g=groups[key];g.Total++;if(c.llamada==="Contestada")g.Contestadas++;if(c.llamada==="No contestada")g["No contestadas"]++;if(c.whatsapp_enviado)g.WhatsApp++;if(c.compromiso_pago)g.Compromisos++;if(c.pago)g.Pagos++;if(c.zona)g.Zonas.add(c.zona);});const rows=Object.values(groups).map(g=>({...g,Zonas:[...g.Zonas].join(", ")||"—"}));const ws=window.XLSX.utils.json_to_sheet(rows.length?rows:[{Asesor:"",Total:0,Contestadas:0,"No contestadas":0,WhatsApp:0,Compromisos:0,Pagos:0,Zonas:""}]);ws["!cols"]=[{wch:28},{wch:10},{wch:14},{wch:17},{wch:12},{wch:14},{wch:10},{wch:35}];const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,ws,"Llamadas por asesor");window.XLSX.writeFile(wb,`resumen-llamadas-por-asesor-${new Date().toISOString().slice(0,10)}.xlsx`);showToast("Resumen por asesor descargado en Excel.");}catch(e){console.error(e);showToast("No fue posible generar el Excel del resumen.",true);}}

  function buildAdvisorReportHTML(){
    const list=calls,total=list.length,contestadas=list.filter(c=>c.llamada==="Contestada").length,no=list.filter(c=>c.llamada==="No contestada").length,equivocadas=list.filter(c=>c.llamada==="Equivocada").length,compromisos=list.filter(c=>c.compromiso_pago).length,pagos=list.filter(c=>c.pago).length,pct=n=>total?Math.round(n/total*100):0;
    const nombre=[currentProfile?.nombre,currentProfile?.apellido].filter(Boolean).join(" ")||currentProfile?.email||"Asesor";
    const meta=metaDe(currentProfile),avance=metaPct(total,meta);
    const rows=list.map(c=>`<tr><td>${escapeHTML(c.cliente)}</td><td>${escapeHTML(c.llamada)}</td><td>${escapeHTML(c.zona)}</td><td>${formatDate(c.fecha_llamada)}</td><td>${c.compromiso_pago?formatDate(c.fecha_compromiso):"—"}</td><td>${c.pago?"Sí":"No"}</td></tr>`).join("");
    return `<div class="print-report-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">REPORTE DE AVANCE</span><h1>${escapeHTML(nombre)}</h1><p>Zona: <strong>${escapeHTML(currentProfile?.zona||"—")}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total llamadas</span><strong>${total}</strong></div><div class="print-summary-card"><span>Contestadas</span><strong>${contestadas}</strong></div><div class="print-summary-card"><span>Compromisos</span><strong>${compromisos}</strong></div><div class="print-summary-card"><span>Pagos</span><strong>${pagos}</strong></div><div class="print-summary-card"><span>Meta asignada</span><strong>${meta}</strong></div><div class="print-summary-card"><span>Avance de la meta</span><strong>${avance}%</strong></div><div class="print-summary-card"><span>Pendientes</span><strong>${Math.max(0,meta-total)}</strong></div></div><section class="print-charts"><div class="print-chart-card"><h2>Tipo de llamada</h2><div class="print-donut" style="--first:${pct(contestadas)*3.6}deg"><div class="print-donut-center"><strong>${total}</strong><span>total</span></div></div><div class="print-legend"><span>Contestada <strong>${pct(contestadas)}%</strong></span><span>No contestada <strong>${pct(no)}%</strong></span><span>Equivocada <strong>${pct(equivocadas)}%</strong></span></div></div></section><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">DETALLE</span><h2>Mis llamadas</h2></div><strong>${total} resultado${total===1?"":"s"}</strong></div><div class="print-table-scroll"><table><thead><tr><th>Cliente</th><th>Llamada</th><th>Zona</th><th>Fecha</th><th>Compromiso</th><th>Pago</th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="print-empty-row">No hay registros.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function previewAdvisorReport(){previewReport(buildAdvisorReportHTML);}
  function printAdvisorReport(){printReport(buildAdvisorReportHTML);}
  function downloadAdvisorPDF(){downloadPDF(buildAdvisorReportHTML,"mi-reporte-cartera");}

  function downloadExcel(){
    try{
      if(!window.XLSX){showToast("No se pudo cargar el módulo de Excel.",true);return;}
      const filtered=getFilteredAdminCalls();
      const total=filtered.length,contestadas=filtered.filter(c=>c.llamada==="Contestada").length,no=filtered.filter(c=>c.llamada==="No contestada").length,equivocadas=filtered.filter(c=>c.llamada==="Equivocada").length,compromisos=filtered.filter(c=>c.compromiso_pago).length,pagos=filtered.filter(c=>c.pago).length,pct=n=>total?Math.round(n/total*100):0;
      const detail=filtered.map(c=>{const a=c.perfilescr||{};return {"Asesor":[a.nombre,a.apellido].filter(Boolean).join(" ")||"—","Cliente":c.cliente,"Llamada":c.llamada,"Zona":c.zona||"—","WhatsApp":c.whatsapp_enviado?"Sí":"No","Compromiso":c.compromiso_pago?formatDate(c.fecha_compromiso):"—","Pago":c.pago?"Sí":"No","Fecha":c.fecha_llamada};});
      const ws=window.XLSX.utils.json_to_sheet(detail.length?detail:[{"Asesor":"","Cliente":"","Llamada":"","Zona":"","WhatsApp":"","Compromiso":"","Pago":"","Fecha":""}]);
      ws["!cols"]=[{wch:25},{wch:22},{wch:16},{wch:16},{wch:10},{wch:14},{wch:8},{wch:14}];
      const metas=metasResumen(filtered),metaTotal=metas.reduce((a,f)=>a+f.meta,0);
      const summary=[
        ["REPORTE DE CARTERA"],["Periodo",value("filtroDesdeAdmin")||value("filtroHastaAdmin")?`${value("filtroDesdeAdmin")?formatDate(value("filtroDesdeAdmin")):"Inicio"} – ${value("filtroHastaAdmin")?formatDate(value("filtroHastaAdmin")):"Actual"}`:"Todos los periodos"],[],
        ["RESUMEN GENERAL"],["Indicador","Cantidad","Porcentaje"],["Total llamadas",total,"100%"],["Contestadas",contestadas,`${pct(contestadas)}%`],["No contestadas",no,`${pct(no)}%`],["Equivocadas",equivocadas,`${pct(equivocadas)}%`],["Compromisos de pago",compromisos,`${pct(compromisos)}%`],["Pagos",pagos,`${pct(pagos)}%`],["Meta total de llamadas",metaTotal,`${metaPct(total,metaTotal)}% cumplido`],[],
        ["CUMPLIMIENTO DE METAS POR ASESOR"],["Asesor","Meta","Llamadas realizadas","Pendientes","% de cumplimiento"],...metas.map(f=>[f.nombre,f.meta,f.hechas,f.pendientes,`${f.pct}%`]),[],
        ["GRÁFICO · TIPO DE LLAMADA"],["Categoría","Cantidad","%","Representación"],["Contestada",contestadas,pct(contestadas),"█".repeat(Math.max(0,Math.round(pct(contestadas)/5)))],["No contestada",no,pct(no),"█".repeat(Math.max(0,Math.round(pct(no)/5)))],["Equivocada",equivocadas,pct(equivocadas),"█".repeat(Math.max(0,Math.round(pct(equivocadas)/5)))]
      ];
      const wr=window.XLSX.utils.aoa_to_sheet(summary);wr["!cols"]=[{wch:34},{wch:15},{wch:20},{wch:15},{wch:20}];
      const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,wr,"Resumen y gráficos");window.XLSX.utils.book_append_sheet(wb,ws,"Detalle");
      window.XLSX.writeFile(wb,`reporte-cartera-${new Date().toISOString().slice(0,10)}.xlsx`);showToast("Excel descargado con resumen y gráficos.");
    }catch(e){console.error(e);showToast("No fue posible generar el Excel.",true);}
  }

  function populateSurveyFilters(){
    const select=id("filtroEncuestaAsesor"); if(!select)return;
    const current=select.value;
    select.innerHTML='<option value="">Todos los asesores</option>'+advisors.map(a=>`<option value="${a.id}">${escapeHTML([a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Asesor")}</option>`).join("");
    select.value=current;
  }
  function getFilteredSurveys(){
    const asesor=value("filtroEncuestaAsesor"),from=value("filtroEncuestaDesde"),to=value("filtroEncuestaHasta"),text=value("filtroEncuestaTexto").toLowerCase();
    return surveys.filter(s=>{
      const a=s.perfilescr||{}, l=s.llamadascr||{};
      const search=[a.nombre,a.apellido,a.email,s.codigo_usuario,s.calificacion_servicio,s.calificacion_tecnica,s.calificacion_administrativa,s.agilidad_averias,s.recomendaria,s.recomendacion_felicitacion,s.observacion_servicio,s.observacion_tecnica,s.observacion_administrativa,l.cliente,l.zona].join(" ").toLowerCase();
      const fecha=l.fecha_llamada||"";
      return (!asesor||s.asesor_id===asesor)&&(!from||fecha>=from)&&(!to||fecha<=to)&&(!text||search.includes(text));
    });
  }
  function renderSurveys(){
    const tbody=id("tabla-encuestas"); if(!tbody)return;
    const filtered=getFilteredSurveys();
    setText("survey-result-count",`${filtered.length} encuesta${filtered.length===1?"":"s"}`);
    tbody.innerHTML=filtered.length?filtered.map(s=>{
      const a=s.perfilescr||{},l=s.llamadascr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—";
      return `<tr><td>${formatDate(l.fecha_llamada)}</td><td><strong>${escapeHTML(name)}</strong></td><td>${escapeHTML(l.cliente||"—")}</td><td>${escapeHTML(l.zona||"—")}</td><td>${escapeHTML(l.llamada||"—")}</td><td>${escapeHTML(s.codigo_usuario)}</td><td>${escapeHTML(s.calificacion_servicio)}</td><td>${escapeHTML(s.calificacion_tecnica)}</td><td>${escapeHTML(s.calificacion_administrativa)}</td><td>${escapeHTML(s.agilidad_averias)}</td><td>${escapeHTML(s.recomendaria)}</td><td>${escapeHTML(s.recomendacion_felicitacion||"—")}</td><td>${escapeHTML(s.observacion_servicio||"—")}</td><td>${escapeHTML(s.observacion_tecnica||"—")}</td><td>${escapeHTML(s.observacion_administrativa||"—")}</td></tr>`;
    }).join(""):`<tr class="empty-row"><td colspan="12">${surveys.length?"No se encontraron encuestas con los filtros seleccionados.":"No hay encuestas registradas."}</td></tr>`;
  }
  function clearSurveyFilters(){
    ["filtroEncuestaAsesor","filtroEncuestaDesde","filtroEncuestaHasta","filtroEncuestaTexto"].forEach(x=>{if(id(x))id(x).value="";});
    renderSurveys();
  }
  function surveyPeriod(){
    const from=value("filtroEncuestaDesde"),to=value("filtroEncuestaHasta");
    return from||to?`${from?formatDate(from):"Inicio"} – ${to?formatDate(to):"Actual"}`:"Todos los periodos";
  }
  function surveyAdvisorFilterName(){
    const uid=value("filtroEncuestaAsesor"),a=advisors.find(x=>x.id===uid);
    return a?[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Asesor":"Todos los asesores";
  }
  function buildSurveyReportHTML(){
    const filtered=getFilteredSurveys();
    const questions=[
      ["01. Usuario encuestado",s=>s.codigo_usuario],
      ["02. Servicio",s=>s.calificacion_servicio],
      ["03. Técnica",s=>s.calificacion_tecnica],
      ["04. Administrativa",s=>s.calificacion_administrativa],
      ["05. Averías",s=>s.agilidad_averias],
      ["06. Recomendaría",s=>s.recomendaria],
      ["07. Recomendación / felicitación",s=>s.recomendacion_felicitacion]
    ];
    const rows=filtered.map(s=>{
      const a=s.perfilescr||{},l=s.llamadascr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—";
      return `<tr><td>${formatDate(l.fecha_llamada)}</td><td>${escapeHTML(name)}</td><td>${escapeHTML(l.cliente||"—")}</td><td>${escapeHTML(l.zona||"—")}</td><td>${escapeHTML(l.llamada||"—")}</td>${questions.map(([,get])=>`<td>${escapeHTML(get(s)||"—")}</td>`).join("")}<td>${escapeHTML(s.observacion_servicio||"—")}</td><td>${escapeHTML(s.observacion_tecnica||"—")}</td><td>${escapeHTML(s.observacion_administrativa||"—")}</td></tr>`;
    }).join("");
    return `<div class="print-report-sheet survey-print-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">REPORTE DE SATISFACCIÓN</span><h1>Encuestas por asesor</h1><p>Asesor: <strong>${escapeHTML(surveyAdvisorFilterName())}</strong> · Periodo: <strong>${escapeHTML(surveyPeriod())}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total encuestas</span><strong>${filtered.length}</strong></div><div class="print-summary-card"><span>Recomendarían</span><strong>${filtered.filter(s=>s.recomendaria==="SI").length}</strong></div><div class="print-summary-card"><span>No recomendarían</span><strong>${filtered.filter(s=>s.recomendaria==="NO").length}</strong></div></div><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">7 RESPUESTAS</span><h2>Detalle de encuestas</h2></div><strong>${filtered.length} encuesta${filtered.length===1?"":"s"}</strong></div><div class="print-table-scroll"><table class="survey-report-table"><thead><tr><th>Fecha</th><th>Asesor</th><th>Cliente</th><th>Zona</th><th>Llamada</th><th>01. Usuario</th><th>02. Servicio</th><th>03. Técnica</th><th>04. Administrativa</th><th>05. Averías</th><th>06. Recomendaría</th><th>07. Recomendación</th><th>Obs. servicio</th><th>Obs. técnica</th><th>Obs. administrativa</th></tr></thead><tbody>${rows||'<tr><td colspan="15" class="print-empty-row">No hay encuestas para los filtros seleccionados.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function downloadSurveyExcel(){
    try{
      if(!window.XLSX){showToast("No se pudo cargar el módulo de Excel.",true);return;}
      const filtered=getFilteredSurveys();
      const detail=filtered.map(s=>{
        const a=s.perfilescr||{},l=s.llamadascr||{};
        return {
          "Fecha":l.fecha_llamada||"","Asesor":[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—",
          "01. Usuario encuestado":s.codigo_usuario||"","02. Servicio":s.calificacion_servicio||"",
          "03. Técnica":s.calificacion_tecnica||"","04. Administrativa":s.calificacion_administrativa||"",
          "05. Averías":s.agilidad_averias||"","06. Recomendaría":s.recomendaria||"",
          "07. Recomendación / felicitación":s.recomendacion_felicitacion||"",
          "Observación servicio":s.observacion_servicio||"","Observación técnica":s.observacion_tecnica||"",
          "Observación administrativa":s.observacion_administrativa||""
        };
      });
      const ws=window.XLSX.utils.json_to_sheet(detail.length?detail:[{"Fecha":"","Asesor":""}]);
      ws["!cols"]=[{wch:14},{wch:24},{wch:28},{wch:18},{wch:18},{wch:20},{wch:22},{wch:16},{wch:40},{wch:35},{wch:35},{wch:35}];
      const wb=window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb,ws,"Encuestas");
      const summary=window.XLSX.utils.aoa_to_sheet([["REPORTE DE ENCUESTAS"],["Asesor",surveyAdvisorFilterName()],["Periodo",surveyPeriod()],["Total encuestas",filtered.length],["Recomendarían",filtered.filter(s=>s.recomendaria==="SI").length],["No recomendarían",filtered.filter(s=>s.recomendaria==="NO").length]]);
      window.XLSX.utils.book_append_sheet(wb,summary,"Resumen");
      window.XLSX.writeFile(wb,`reporte-encuestas-cartera-${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Reporte de encuestas descargado.");
    }catch(e){console.error(e);showToast("No fue posible generar el Excel de encuestas.",true);}
  }

  function showAuthView(){["auth-view","register-view","vista-asesor","admin-dashboard","vista-admin","vista-encuestas","vista-usuarios","vista-configuracion","vista-respaldo"].forEach(x=>id(x).classList.add("hidden"));id("auth-view").classList.remove("hidden");id("session-area").classList.add("hidden");id("btn-menu").classList.add("hidden");id("sidebar").classList.add("hidden");}
  function showView(viewId){["auth-view","register-view","vista-asesor","admin-dashboard","vista-admin","vista-encuestas","vista-usuarios","vista-configuracion","vista-respaldo"].forEach(x=>id(x).classList.add("hidden"));id(viewId).classList.remove("hidden");if(viewId!=="auth-view"&&currentProfile){id("session-area").classList.remove("hidden");id("btn-menu").classList.remove("hidden");id("sidebar").classList.remove("hidden");}}
  async function logout(){const {error}=await sbClient.auth.signOut();if(error)showToast("No fue posible cerrar la sesión.",true);}
  function llamadaBadge(t){if(t==="Contestada")return '<span class="badge badge-complete">Contestada</span>';if(t==="Equivocada")return '<span class="badge badge-cancelled">Equivocada</span>';return '<span class="badge badge-pending">No contestada</span>';}
  function whatsappBadge(c){return c.whatsapp_enviado?'<span class="badge badge-active">Enviado</span>':'<span class="badge badge-disabled">No</span>';}
  function pagoBadge(v){return v?'<span class="badge badge-active">Sí</span>':'<span class="badge badge-disabled">No</span>';}
  function compromisoCell(c){return c.compromiso_pago?`<span class="badge badge-pending">${formatDate(c.fecha_compromiso)}</span>`:'<span class="badge badge-disabled">—</span>';}
  function formatDate(d){if(!d)return "—";const p=d.split("-");return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:escapeHTML(d);}
  function setTodayDefault(){const x=id("fechaLlamada");if(x&&!x.value)x.value=getTodayISO();}function getTodayISO(){const n=new Date(),o=n.getTimezoneOffset(),l=new Date(n.getTime()-o*60000);return l.toISOString().slice(0,10);}
  function value(x){return id(x).value.trim();}function id(x){return document.getElementById(x);}function setText(x,v){if(id(x))id(x).textContent=v;}
  function escapeHTML(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");}
  async function downloadBackup(){
    const btn=id("btn-download-backup"),status=id("backup-status");
    if(!window.XLSX){showToast("No se pudo cargar el módulo de Excel.",true);return;}
    setButtonBusy(btn,true,"Generando respaldo...");
    try{
      const [callsRes,encRes,perfilesRes]=await Promise.all([
        sbClient.from("llamadascr").select("*").order("id",{ascending:true}),
        sbClient.from("encuestascr").select("*").order("id",{ascending:true}),
        sbClient.from("perfilescr").select("*").order("created_at",{ascending:true})
      ]);
      if(callsRes.error||encRes.error||perfilesRes.error){console.error(callsRes.error||encRes.error||perfilesRes.error);showToast("No fue posible generar el respaldo.",true);return;}
      const wb=window.XLSX.utils.book_new();
      const wsCalls=window.XLSX.utils.json_to_sheet(callsRes.data&&callsRes.data.length?callsRes.data:[{id:""}]);
      const wsEnc=window.XLSX.utils.json_to_sheet(encRes.data&&encRes.data.length?encRes.data:[{id:""}]);
      const wsPerfiles=window.XLSX.utils.json_to_sheet(perfilesRes.data&&perfilesRes.data.length?perfilesRes.data:[{id:""}]);
      window.XLSX.utils.book_append_sheet(wb,wsCalls,"Llamadas");
      window.XLSX.utils.book_append_sheet(wb,wsEnc,"Encuestas");
      window.XLSX.utils.book_append_sheet(wb,wsPerfiles,"Perfiles");
      const now=new Date();
      window.XLSX.writeFile(wb,`respaldo-cartera-${now.toISOString().slice(0,10)}.xlsx`);
      status.textContent=`Último respaldo generado: ${now.toLocaleString("es-CO")} · ${callsRes.data.length} llamadas, ${encRes.data.length} encuestas, ${perfilesRes.data.length} perfiles.`;
      showToast("Respaldo generado correctamente.");
    }catch(e){console.error(e);showToast("No fue posible generar el respaldo.",true);}
    finally{setButtonBusy(btn,false,"⭳ Descargar respaldo completo");}
  }

  function setButtonBusy(b,busy,text){if(!b)return;b.disabled=busy;b.textContent=text;}function authError(e){const m=(e?.message||"").toLowerCase();if(m.includes("invalid login credentials"))return "Correo o contraseña incorrectos.";if(m.includes("email not confirmed"))return "Debes confirmar tu correo antes de iniciar sesión.";if(m.includes("user already registered"))return "Ese correo ya está registrado.";return e?.message||"No fue posible completar la operación.";}
  function fileToDataURL(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);});}
  let toastTimer;function showToast(msg,error=false){const t=id("toast");t.textContent=msg;t.classList.toggle("error",error);t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),3500);}

  window.setPago=setPago;window.deleteCall=deleteCall;window.editAdvisor=editAdvisor;window.toggleAdvisor=toggleAdvisor;window.deleteAdvisor=deleteAdvisor;
})();
