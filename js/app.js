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
  const LLAMADA_REPORT_TYPES = [...LLAMADA_TYPES, "Sin especificar"];
  // Zonas predeterminadas del sistema de cartera.
  const ZONAS = ["San Marcos", "Caucasia", "Caucasia Subsidiada", "Montelíbano", "La Apartada", "Buenavista"];
  // Tipo de gestión realizada en la llamada.
  const TIPOS_GESTION = ["Llamadas recibidas", "WhatsApp recibido", "Gestión reporte a Data Crédito y abogados", "Gestión lista de suspensión", "Gestión recuperación de equipo", "Gestión ofreciendo servicio de la empresa", "Gestión actualización de información", "Gestión factura del mes"];
  const META_POR_DEFECTO = 500;
  let currentUser = null, currentProfile = null, calls = [], advisorFilteredCalls = null, advisors = [], reportAdvisors = [], surveys = [], seguimientoSurveys = [], servicioSurveys = [], config = { color_principal: "#0ea5e9", logo_url: "" };
  let advisorSearchTimer = null;
  const CACHE_TTL = 5 * 60 * 1000;
  const SURVEY_SELECT = `id,llamada_id,asesor_id,codigo_usuario,calificacion_servicio,observacion_servicio,calificacion_tecnica,observacion_tecnica,calificacion_administrativa,observacion_administrativa,agilidad_averias,recomendaria,recomendacion_felicitacion,zona,fecha_encuesta,created_at,perfilescr:asesor_id (id,nombre,apellido,email,rol,activo),llamadascr:llamada_id (id,cliente,llamada,tipo_gestion,zona,fecha_llamada,observaciones,asesor_id)`;
  let surveyCallSearchTimer = null;
  const memoryCache = new Map();
  const pendingCache = new Map();
  let dashboardCartera = null;
  let reportCalls = null;
  let reportSurveys = null;

  function cacheGet(key){
    const now=Date.now();
    const mem=memoryCache.get(key);
    if(mem && now-mem.ts<CACHE_TTL) return mem.data;
    if(mem) memoryCache.delete(key);
    try{
      const raw=localStorage.getItem(`cartera-cache:${key}`);
      if(raw){const parsed=JSON.parse(raw);if(now-parsed.ts<CACHE_TTL){memoryCache.set(key,parsed);return parsed.data;}localStorage.removeItem(`cartera-cache:${key}`);}
    }catch(e){}
    return null;
  }
  function cacheSet(key,data){
    const entry={ts:Date.now(),data}; memoryCache.set(key,entry);
    try{localStorage.setItem(`cartera-cache:${key}`,JSON.stringify(entry));}catch(e){}
    return data;
  }
  function cacheInvalidate(key){memoryCache.delete(key);try{localStorage.removeItem(`cartera-cache:${key}`);}catch(e){}}
  function cacheInvalidatePrefix(prefix){[...memoryCache.keys()].filter(k=>k.startsWith(prefix)).forEach(cacheInvalidate);try{Object.keys(localStorage).filter(k=>k.startsWith(`cartera-cache:${prefix}`)).forEach(k=>localStorage.removeItem(k));}catch(e){}}
  async function cachedQuery(key,queryFactory,force=false){
    if(!force){const cached=cacheGet(key);if(cached!==null)return cached;}
    if(pendingCache.has(key))return pendingCache.get(key);
    const promise=Promise.resolve().then(queryFactory).then(result=>{cacheSet(key,result);return result;}).finally(()=>pendingCache.delete(key));
    pendingCache.set(key,promise); return promise;
  }
  function monthStartISO(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;}
  function todayISO(){return getTodayISO();}
  function nextISODate(day){const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+1);return d.toISOString().slice(0,10);}
  function colombiaDayBounds(day){return {from:`${day}T05:00:00.000Z`,to:`${nextISODate(day)}T05:00:00.000Z`};}
  function colombiaDateFromTimestamp(value){if(!value)return "";return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Bogota",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));}
  function monthEndISO(){const d=new Date();const last=new Date(d.getFullYear(),d.getMonth()+1,0);return `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2,'0')}-${String(last.getDate()).padStart(2,'0')}`;}
  async function loadMonthlyDashboard(force=false){
    if(!currentUser)return null;
    const key=`dashboard:cartera:${currentUser.id}:${monthStartISO()}`;
    try{
      return await cachedQuery(key,async()=>{
        const {data,error}=await sbClient.rpc("dashboard_cartera_mensual",{p_month_start:monthStartISO()});
        if(error)throw error;
        return data||null;
      },force);
    }catch(error){
      console.warn("RPC dashboard_cartera_mensual no disponible",error);
      return null;
    }
  }
  async function loadRecentAdminData(){
    const today=todayISO();
    const [cr,er,sgr,srr]=await Promise.all([
      cachedQuery(`calls:admin:${today}`,()=>sbClient.from("llamadascr").select(`*, perfilescr:asesor_id (id,nombre,apellido,zona,email,activo)`).eq("fecha_llamada",today).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})),
      cachedQuery(`surveys:admin:${today}`,()=>sbClient.from("encuestascr").select(SURVEY_SELECT).eq("fecha_encuesta",today).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})),
      cachedQuery(`seguimiento:admin:${today}`,()=>{const b=colombiaDayBounds(today);return sbClient.from("encuestas_seguimientocr").select("id,asesor_id,usuario,zona,como_se_entero,fechas_pago,medio_contrato,atencion_asesor,redes_sociales,cobro_tecnico,medios_pago,created_at").gte("created_at",b.from).lt("created_at",b.to).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})}),
      cachedQuery(`servicio:admin:${today}`,()=>{const b=colombiaDayBounds(today);return sbClient.from("encuestas_serviciocr").select("id,asesor_id,usuario,zona,servicio_retirado,motivo_retiro,interes_retomar,observaciones,created_at").gte("created_at",b.from).lt("created_at",b.to).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})})
    ]);
    return {calls:cr,surveys:er,seguimiento: sgr,servicio:srr};
  }
  async function loadRecentAdvisorData(){
    const today=todayISO(),uid=currentUser.id;
    const [cr,sr,sgr,srr]=await Promise.all([
      cachedQuery(`calls:advisor:${uid}:${today}`,()=>sbClient.from("llamadascr").select("*").eq("asesor_id",uid).eq("fecha_llamada",today).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})),
      cachedQuery(`surveys:advisor:${uid}:${today}`,()=>sbClient.from("encuestascr").select(SURVEY_SELECT).eq("asesor_id",uid).eq("fecha_encuesta",today).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})),
      cachedQuery(`seguimiento:advisor:${uid}:${today}`,()=>{const b=colombiaDayBounds(today);return sbClient.from("encuestas_seguimientocr").select("id,asesor_id,usuario,zona,como_se_entero,fechas_pago,medio_contrato,atencion_asesor,redes_sociales,cobro_tecnico,medios_pago,created_at").eq("asesor_id",uid).gte("created_at",b.from).lt("created_at",b.to).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})}),
      cachedQuery(`servicio:advisor:${uid}:${today}`,()=>{const b=colombiaDayBounds(today);return sbClient.from("encuestas_serviciocr").select("id,asesor_id,usuario,zona,servicio_retirado,motivo_retiro,interes_retomar,observaciones,created_at").eq("asesor_id",uid).gte("created_at",b.from).lt("created_at",b.to).order("id",{ascending:false}).limit(10).then(r=>{if(r.error)throw r.error;return r.data||[];})})
    ]);
    return {calls:cr,surveys:sr,seguimiento:sgr,servicio:srr};
  }
  let asesoresSeleccionados = []; // [] = todos los asesores

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents(); setTodayDefault(); setAdminCallTodayDefault(); showAuthView(); applyTheme();
    toggleWhatsappFields(); toggleCompromisoField(); toggleAdminWhatsappFields(); toggleAdminCompromisoField();
    const { data: { session } } = await sbClient.auth.getSession();
    if (session?.user) await initializeSession(session.user);
    sbClient.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") { currentUser = null; currentProfile = null; calls = []; advisors = []; surveys = []; showAuthView(); return; }
      // Al cambiar de pestaña y volver, Supabase dispara TOKEN_REFRESHED (y a veces SIGNED_IN otra vez)
      // solo para revalidar la sesión. Si ya tenemos ese mismo usuario cargado, no se debe reinicializar
      // la sesión ni recalcular la vista: eso es lo que causaba el salto a "inicio".
      if (event === "INITIAL_SESSION") return;
      if (session?.user && currentUser?.id !== session.user.id) { await initializeSession(session.user); return; }
      if (session?.user) currentUser = session.user; // solo refrescamos el token en segundo plano
    });
  });

  function bindEvents() {
    id("login-form").addEventListener("submit", login); id("register-form").addEventListener("submit", registerAdvisor); id("call-form").addEventListener("submit", registerCall); id("admin-call-form")?.addEventListener("submit", registerCallAdmin); id("seguimiento-form")?.addEventListener("submit", saveSeguimientoSurvey); id("servicio-form")?.addEventListener("submit", saveServicioSurvey);
    id("btn-show-register").addEventListener("click", () => { id("auth-view").classList.add("hidden"); id("register-view").classList.remove("hidden"); });
    id("btn-back-login").addEventListener("click", showAuthView); id("btn-logout").addEventListener("click", logout);
    id("btn-menu").addEventListener("click", () => id("sidebar").classList.toggle("open")); id("btn-close-menu").addEventListener("click", closeSidebar);
    id("btn-refresh-dashboard")?.addEventListener("click", refreshCarteraData);
    id("buscar-asesor")?.addEventListener("input", searchAdvisors);
    id("btn-limpiar-busqueda-asesor")?.addEventListener("click", clearAdvisorSearch);
    id("filtroAsesor").addEventListener("input", renderAdvisorTable);
    id("filtroAsesorDesde").addEventListener("change", applyAdvisorFilters);
    id("filtroAsesorHasta").addEventListener("change", applyAdvisorFilters);
    id("btn-limpiar-filtro-asesor").addEventListener("click", clearAsesorFilters);
    id("whatsappEnviado").addEventListener("change", toggleWhatsappFields);
    id("compromisoPago").addEventListener("change", toggleCompromisoField);
    id("adminCallWhatsapp")?.addEventListener("change", toggleAdminWhatsappFields);
    id("adminCallCompromiso")?.addEventListener("change", toggleAdminCompromisoField);
    ["filtroAdminTexto","filtroLlamadaAdmin","filtroTipoGestionAdmin","filtroCompromisoAdmin","filtroPagoAdmin","filtroZonaAdmin"].forEach(x => { id(x).addEventListener("input", renderAdmin); id(x).addEventListener("change", renderAdmin); });
    ["filtroDesdeAdmin","filtroHastaAdmin"].forEach(x => id(x).addEventListener("change", applyAdminFilters));
    id("ms-asesores-toggle").addEventListener("click", (e) => { e.stopPropagation(); id("ms-asesores-panel").classList.toggle("hidden"); });
    id("ms-asesores-all").addEventListener("click", () => { asesoresSeleccionados = []; syncAsesoresChecklist(); renderAdmin(); });
    id("ms-asesores-none").addEventListener("click", () => { const source=reportAdvisors.length?reportAdvisors:advisors; asesoresSeleccionados = source.map(a => a.id); syncAsesoresChecklist(source); renderAdmin(); });
    document.addEventListener("click", (e) => { const panel = id("ms-asesores-panel"), box = id("ms-asesores"); if (panel && !panel.classList.contains("hidden") && box && !box.contains(e.target)) panel.classList.add("hidden"); });
    id("btn-clear-filters").addEventListener("click", clearAdminFilters); id("btn-preview-report").addEventListener("click", async () => {await prepareReportData();previewReport();reportCalls=null;reportSurveys=null;}); id("btn-close-report-preview").addEventListener("click", closeReportPreview); id("btn-print-report").addEventListener("click", async () => {await prepareReportData();printReport();reportCalls=null;reportSurveys=null;}); id("btn-pdf-report").addEventListener("click", async () => {await prepareReportData();downloadPDF();reportCalls=null;reportSurveys=null;}); id("btn-excel-report").addEventListener("click", async () => {await prepareReportData();downloadExcel();reportCalls=null;reportSurveys=null;});
    id("btn-preview-advisor-summary").addEventListener("click", async () => {await prepareReportData();previewReport(buildAdvisorSummaryReportHTML);reportCalls=null;reportSurveys=null;}); id("btn-print-advisor-summary").addEventListener("click", async () => {await prepareReportData();printReport(buildAdvisorSummaryReportHTML);reportCalls=null;reportSurveys=null;}); id("btn-pdf-advisor-summary").addEventListener("click", async () => {await prepareReportData();downloadPDF(buildAdvisorSummaryReportHTML,"resumen-llamadas-por-asesor");reportCalls=null;reportSurveys=null;}); id("btn-excel-advisor-summary").addEventListener("click", async () => {await prepareReportData();downloadAdvisorSummaryExcel();reportCalls=null;reportSurveys=null;});
    id("admin-user-form").addEventListener("submit", saveAdminUser); id("admin-survey-form").addEventListener("submit", saveAdminSurvey); id("btn-cancel-user-edit").addEventListener("click", resetUserForm);
    id("adminEncOrigen")?.addEventListener("change", toggleSurveyCallMode); id("adminEncLlamada")?.addEventListener("change", applySelectedSurveyCall); id("adminEncLlamadaSearch")?.addEventListener("input",()=>{clearTimeout(surveyCallSearchTimer);surveyCallSearchTimer=setTimeout(()=>loadSurveyCalls(value("adminEncLlamadaSearch")),350);});
    ["filtroEncuestaTexto"].forEach(x => { if(id(x)) id(x).addEventListener("input", renderSurveys); });
    ["filtroEncuestaDesde","filtroEncuestaHasta"].forEach(x => { if(id(x)) id(x).addEventListener("change", applySurveyFilters); });
    id("btn-clear-survey-filters").addEventListener("click", clearSurveyFilters);
    id("btn-preview-survey-report").addEventListener("click", async () => {await prepareReportData();previewReport(buildSurveyReportHTML);reportCalls=null;reportSurveys=null;});
    id("btn-print-survey-report").addEventListener("click", async () => {await prepareReportData();printReport(buildSurveyReportHTML);reportCalls=null;reportSurveys=null;});
    id("btn-pdf-survey-report").addEventListener("click", async () => {await prepareReportData();downloadPDF(buildSurveyReportHTML,"reporte-encuestas-cartera");reportCalls=null;reportSurveys=null;});
    id("btn-excel-survey-report").addEventListener("click", async () => {await prepareReportData();downloadSurveyExcel();reportCalls=null;reportSurveys=null;});
    id("config-form").addEventListener("submit", saveConfig); id("btn-remove-logo").addEventListener("click", removeLogo);
    id("btn-asesor-report").addEventListener("click", async () => {await loadHistoricalCalls();previewAdvisorReport();reportCalls=null;}); id("btn-asesor-print").addEventListener("click", async () => {await loadHistoricalCalls();printAdvisorReport();reportCalls=null;}); id("btn-asesor-pdf").addEventListener("click", async () => {await loadHistoricalCalls();downloadAdvisorPDF();reportCalls=null;});
    id("btn-download-backup").addEventListener("click", downloadBackup);
    document.querySelectorAll("[data-hub-open]").forEach(b=>b.addEventListener("click",()=>{showView(b.dataset.hubOpen);setSectionMode(b.dataset.hubOpen,b.dataset.hubMode||"form");}));
    document.querySelectorAll("[data-hub-back]").forEach(b=>b.addEventListener("click",()=>showView("vista-encuestas-hub")));
  }

  function toggleWhatsappFields(){const on=id("whatsappEnviado").value==="true";id("whatsappMensajeGroup").classList.toggle("hidden",!on);id("whatsappRespuestaGroup").classList.toggle("hidden",!on);}
  function toggleCompromisoField(){const on=id("compromisoPago").value==="true";id("fechaCompromisoGroup").classList.toggle("hidden",!on);}

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

  async function loadConfig(){const data=await cachedQuery("config:cartera",async()=>{const {data,error}=await sbClient.from("configuracioncr").select("color_principal,logo_url").eq("id",1).maybeSingle();if(error)throw error;return data||null;});if(data) config=data;applyTheme();renderConfig();}

  async function loadAdvisorData(){
    try{
      const recent=await loadRecentAdvisorData();
      calls=recent.calls; advisorFilteredCalls=null; surveys=recent.surveys; seguimientoSurveys=recent.seguimiento; servicioSurveys=recent.servicio;
      dashboardCartera=await loadMonthlyDashboard(false);
      applyAdvisorProfile();updateAdvisorDashboard();renderAdvisorTable();renderSeguimientoAsesor();renderSurveys();renderSeguimientoSurveys();renderServicioSurveys();
    }catch(error){console.error(error);showToast("No fue posible cargar tus datos recientes.",true);}
  }

  async function loadAdminData(force=false){
    try{
      const recent=await loadRecentAdminData();
      calls=recent.calls; advisors=[]; surveys=recent.surveys; seguimientoSurveys=recent.seguimiento; servicioSurveys=recent.servicio;
      dashboardCartera=await loadMonthlyDashboard(force);
      populateAdminFilters(); populateSurveyFilters(); populateSurveyAdvisorSelects(); renderAdmin(); renderSurveys(); renderSeguimientoSurveys(); renderServicioSurveys(); renderUsers(); updateAdminDashboard(dashboardCartera); renderConfig();
    }catch(error){console.error(error);showToast("No fue posible cargar los datos de Cartera.",true);}
  }

  async function refreshCarteraData(){cacheInvalidatePrefix("calls:");cacheInvalidatePrefix("surveys:");cacheInvalidatePrefix("seguimiento:");cacheInvalidatePrefix("servicio:");cacheInvalidatePrefix("dashboard:cartera:");cacheInvalidate("advisors:report");dashboardCartera=null;await loadAdminData(true);clearAdvisorSearch();showToast("Dashboard y datos recientes actualizados.");}
  async function loadHistoricalCalls(){
    const from=value("filtroDesdeAdmin"),to=value("filtroHastaAdmin");
    const key=`calls:history:${from||"all"}:${to||"all"}`;
    reportCalls=await cachedQuery(key,()=>{let q=sbClient.from("llamadascr").select(`*, perfilescr:asesor_id (id,nombre,apellido,zona,email,activo)`).order("fecha_llamada",{ascending:false}).order("id",{ascending:false});if(from)q=q.gte("fecha_llamada",from);if(to)q=q.lte("fecha_llamada",to);return q.then(r=>{if(r.error)throw r.error;return r.data||[];});});
    return reportCalls;
  }
  async function applyAdminFilters(){
    const from=value("filtroDesdeAdmin"),to=value("filtroHastaAdmin");
    if(from||to){
      try{ await loadHistoricalCalls(); }catch(e){ console.error(e); showToast("No fue posible cargar las llamadas del periodo seleccionado.",true); return; }
    }else{ reportCalls=null; }
    renderAdmin();
  }
  async function loadHistoricalAdvisorCalls(){
    const from=value("filtroAsesorDesde"),to=value("filtroAsesorHasta"),uid=currentUser?.id;
    if(!uid)return;
    const key=`calls:advisor-history:${uid}:${from||"all"}:${to||"all"}`;
    const result=await cachedQuery(key,()=>{let q=sbClient.from("llamadascr").select("*").eq("asesor_id",uid).order("fecha_llamada",{ascending:false}).order("id",{ascending:false});if(from)q=q.gte("fecha_llamada",from);if(to)q=q.lte("fecha_llamada",to);return q.then(r=>{if(r.error)throw r.error;return r.data||[];});});
    advisorFilteredCalls=result;
    return result;
  }
  async function applyAdvisorFilters(){
    const from=value("filtroAsesorDesde"),to=value("filtroAsesorHasta");
    if(from||to){
      try{ await loadHistoricalAdvisorCalls(); }catch(e){ console.error(e); showToast("No fue posible cargar las llamadas del periodo seleccionado.",true); return; }
    }else{ const recent=await loadRecentAdvisorData(); calls=recent.calls; advisorFilteredCalls=null; }
    renderAdvisorTable();
  }
  function advisorNameById(uid){
    const a=advisors.find(x=>x.id===uid);
    return a?[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Asesor":"Asesor";
  }
  function surveyAdvisorIds(kind){
    const map={satisfaccion:"ms-encuesta-asesores-list",seguimiento:"ms-seg-asesores-list",servicio:"ms-srv-asesores-list"};
    const el=id(map[kind]);
    if(!el)return [];
    return [...el.querySelectorAll('input[type="checkbox"]:checked')].map(x=>x.value);
  }
  function surveyAdvisorLabel(kind){
    const ids=surveyAdvisorIds(kind);
    if(!ids.length)return "Ningún asesor";
    if(ids.length===advisors.length)return "Todos los asesores";
    if(ids.length===1){const a=advisors.find(x=>x.id===ids[0]);return a?[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Asesor":"1 asesor";}
    return `${ids.length} asesores seleccionados`;
  }
  function populateSurveyMulti(kind){
    const cfg={
      satisfaccion:{list:"ms-encuesta-asesores-list",toggle:"ms-encuesta-asesores-toggle",panel:"ms-encuesta-asesores-panel",all:"ms-encuesta-asesores-all",none:"ms-encuesta-asesores-none"},
      seguimiento:{list:"ms-seg-asesores-list",toggle:"ms-seg-asesores-toggle",panel:"ms-seg-asesores-panel",all:"ms-seg-asesores-all",none:"ms-seg-asesores-none"},
      servicio:{list:"ms-srv-asesores-list",toggle:"ms-srv-asesores-toggle",panel:"ms-srv-asesores-panel",all:"ms-srv-asesores-all",none:"ms-srv-asesores-none"}
    }[kind];
    const list=id(cfg.list); if(!list)return;
    const previous=new Set([...list.querySelectorAll('input:checked')].map(x=>x.value));
    list.innerHTML=advisors.map(a=>{const name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Asesor";return `<label class="multiselect-option"><input type="checkbox" value="${a.id}" ${previous.size?previous.has(a.id):true}> <span>${escapeHTML(name)}</span></label>`;}).join("");
    const toggle=()=>{id(cfg.toggle).textContent=surveyAdvisorLabel(kind);};
    list.querySelectorAll('input').forEach(ch=>ch.addEventListener('change',async()=>{toggle(); if(kind==="satisfaccion") await applySurveyFilters(); else if(kind==="seguimiento"){await loadHistoricalSeguimiento();renderSeguimientoSurveys();} else {await loadHistoricalServicio();renderServicioSurveys();}}));
    const allBtn=id(cfg.all),noneBtn=id(cfg.none);
    if(allBtn&&!allBtn.dataset.bound){allBtn.dataset.bound="1";allBtn.addEventListener('click',async()=>{list.querySelectorAll('input').forEach(x=>x.checked=true);toggle();if(kind==="satisfaccion")await applySurveyFilters();else if(kind==="seguimiento"){await loadHistoricalSeguimiento();renderSeguimientoSurveys();}else{await loadHistoricalServicio();renderServicioSurveys();}});}
    if(noneBtn&&!noneBtn.dataset.bound){noneBtn.dataset.bound="1";noneBtn.addEventListener('click',async()=>{list.querySelectorAll('input').forEach(x=>x.checked=false);toggle();if(kind==="satisfaccion")await applySurveyFilters();else if(kind==="seguimiento"){await loadHistoricalSeguimiento();renderSeguimientoSurveys();}else{await loadHistoricalServicio();renderServicioSurveys();}});}
    const btn=id(cfg.toggle),panel=id(cfg.panel);
    if(btn&&!btn.dataset.bound){btn.dataset.bound="1";btn.addEventListener('click',e=>{e.stopPropagation();panel.classList.toggle('hidden');});}
    toggle();
  }
  function populateSurveyAdvisorSelects(){
    populateSurveyMulti("satisfaccion");
    populateSurveyMulti("seguimiento");
    populateSurveyMulti("servicio");
  }
  async function loadHistoricalSeguimiento(){
    const from=value("seg-filter-from"),to=value("seg-filter-to"),advisorIds=surveyAdvisorIds("seguimiento");
    const key=`seguimiento:history:${from||"all"}:${to||"all"}:${advisorIds.sort().join(",")||"all"}`;
    seguimientoSurveys=await cachedQuery(key,()=>{
      let q=sbClient.from("encuestas_seguimientocr").select("id,asesor_id,usuario,zona,como_se_entero,fechas_pago,medio_contrato,atencion_asesor,redes_sociales,cobro_tecnico,medios_pago,created_at,perfilescr(id,nombre,apellido,email)").order("id",{ascending:false});
      if(advisors.length && !advisorIds.length)return Promise.resolve([]);
      if(advisorIds.length && advisorIds.length<advisors.length) q=q.in("asesor_id",advisorIds);
      if(from){const b=colombiaDayBounds(from);q=q.gte("created_at",b.from);}
      if(to){const b=colombiaDayBounds(to);q=q.lt("created_at",b.to);}
      return q.limit(2000).then(r=>{if(r.error)throw r.error;return r.data||[];});
    });
    return seguimientoSurveys;
  }
  async function loadHistoricalServicio(){
    const from=value("srv-filter-from"),to=value("srv-filter-to"),advisorIds=surveyAdvisorIds("servicio");
    const key=`servicio:history:${from||"all"}:${to||"all"}:${advisorIds.sort().join(",")||"all"}`;
    servicioSurveys=await cachedQuery(key,()=>{
      let q=sbClient.from("encuestas_serviciocr").select("id,asesor_id,usuario,zona,servicio_retirado,motivo_retiro,interes_retomar,observaciones,created_at,perfilescr(id,nombre,apellido,email)").order("id",{ascending:false});
      if(advisors.length && !advisorIds.length)return Promise.resolve([]);
      if(advisorIds.length && advisorIds.length<advisors.length) q=q.in("asesor_id",advisorIds);
      if(from){const b=colombiaDayBounds(from);q=q.gte("created_at",b.from);}
      if(to){const b=colombiaDayBounds(to);q=q.lt("created_at",b.to);}
      return q.limit(2000).then(r=>{if(r.error)throw r.error;return r.data||[];});
    });
    return servicioSurveys;
  }
  async function loadHistoricalSurveys(){
    const from=value("filtroEncuestaDesde"),to=value("filtroEncuestaHasta"),advisorIds=surveyAdvisorIds("satisfaccion");
    const key=`surveys:history:${from||"all"}:${to||"all"}:${advisorIds.sort().join(",")||"all"}`;
    reportSurveys=await cachedQuery(key,()=>{
      // La fecha del reporte es la fecha en que se realizó la encuesta.
      // Esto conserva también las encuestas puerta a puerta (llamada_id NULL).
      let q=sbClient.from("encuestascr").select(SURVEY_SELECT).order("id",{ascending:false});
      if(from)q=q.gte("fecha_encuesta",from);
      if(to)q=q.lte("fecha_encuesta",to);
      if(advisors.length && !advisorIds.length)return Promise.resolve([]);
      if(advisorIds.length && advisorIds.length<advisors.length)q=q.in("asesor_id",advisorIds);
      return q.limit(2000).then(r=>{if(r.error)throw r.error;return r.data||[];});
    });
    return reportSurveys;
  }
  async function applySurveyFilters(){
    const from=value("filtroEncuestaDesde"),to=value("filtroEncuestaHasta");
    if(from||to){
      try{ await loadHistoricalSurveys(); }catch(e){ console.error(e); showToast("No fue posible cargar las encuestas del periodo seleccionado.",true); return; }
    }else{ reportSurveys=null; }
    renderSurveys();
  }
  async function prepareReportData(){
    // Cada carga va por separado: si una falla, las demás siguen y el reporte
    // se genera igual con lo que haya. Antes, un solo error aquí dejaba sin
    // efecto los botones de vista previa, imprimir, PDF y Excel, sin avisar.
    const fallos=[];
    try{ await loadHistoricalCalls(); }catch(e){ console.error("loadHistoricalCalls:",e); fallos.push("llamadas"); }
    try{ await loadReportAdvisors(); }catch(e){ console.error("loadReportAdvisors:",e); fallos.push("asesores"); }
    try{ await loadHistoricalSurveys(); }catch(e){ console.error("loadHistoricalSurveys:",e); fallos.push("encuestas"); }
    if(fallos.length)showToast(`No fue posible cargar: ${fallos.join(", ")}. El reporte puede salir incompleto.`,true);
    if(!Array.isArray(reportAdvisors))reportAdvisors=[];
  }

  async function registerCall(e){
    e.preventDefault(); if(!currentUser||!currentProfile){showToast("Tu sesión no está disponible.",true);return;}
    const whatsapp=id("whatsappEnviado").value==="true", compromiso=id("compromisoPago").value==="true", pago=id("pago").value==="true";
    if(compromiso && !id("fechaCompromiso").value){showToast("Selecciona la fecha del compromiso de pago.",true);return;}
    const zonaSeleccionada=value("zona"); if(!ZONAS.includes(zonaSeleccionada)){showToast("Selecciona una zona válida de la lista.",true);return;}
    const tipoGestionSeleccionado=value("tipoGestion")||null;
    const row={asesor_id:currentUser.id,cliente:value("cliente"),llamada:value("tipoLlamada"),tipo_gestion:tipoGestionSeleccionado,zona:zonaSeleccionada,whatsapp_enviado:whatsapp,whatsapp_mensaje:whatsapp?(value("whatsappMensaje")||null):null,whatsapp_respuesta:whatsapp?(value("whatsappRespuesta")||null):null,compromiso_pago:compromiso,fecha_compromiso:compromiso?id("fechaCompromiso").value:null,pago:pago,observaciones:value("observaciones")||null,fecha_llamada:id("fechaLlamada").value};
    if(!row.cliente||!row.zona||!row.fecha_llamada){showToast("Completa todos los campos obligatorios.",true);return;}
    const {data,error}=await sbClient.from("llamadascr").insert(row).select().single(); if(error){console.error(error);showToast(error.message||"No fue posible registrar la llamada.",true);return;}
    e.target.reset();applyAdvisorProfile();setTodayDefault();toggleWhatsappFields();toggleCompromisoField();calls.unshift(data);cacheInvalidatePrefix(`calls:advisor:${currentUser.id}:`);cacheInvalidatePrefix("dashboard:cartera:");dashboardCartera=await loadMonthlyDashboard(true);renderAdvisorTable();updateAdvisorDashboard();renderSeguimientoAsesor();showToast("Llamada registrada correctamente.");
  }

  function toggleAdminWhatsappFields(){const on=id("adminCallWhatsapp").value==="true";id("adminCallWhatsappMensajeGroup").classList.toggle("hidden",!on);id("adminCallWhatsappRespuestaGroup").classList.toggle("hidden",!on);}
  function toggleAdminCompromisoField(){const on=id("adminCallCompromiso").value==="true";id("adminCallFechaCompromisoGroup").classList.toggle("hidden",!on);}

  async function registerCallAdmin(e){
    e.preventDefault(); if(!currentUser||!currentProfile){showToast("Tu sesión no está disponible.",true);return;}
    const whatsapp=id("adminCallWhatsapp").value==="true", compromiso=id("adminCallCompromiso").value==="true", pago=id("adminCallPago").value==="true";
    if(compromiso && !id("adminCallFechaCompromiso").value){showToast("Selecciona la fecha del compromiso de pago.",true);return;}
    const zonaSeleccionada=value("adminCallZona"); if(!ZONAS.includes(zonaSeleccionada)){showToast("Selecciona una zona válida de la lista.",true);return;}
    const tipoGestionSeleccionado=value("adminCallTipoGestion")||null;
    const row={asesor_id:currentUser.id,cliente:value("adminCallCliente"),llamada:value("adminCallLlamada"),tipo_gestion:tipoGestionSeleccionado,zona:zonaSeleccionada,whatsapp_enviado:whatsapp,whatsapp_mensaje:whatsapp?(value("adminCallWhatsappMensaje")||null):null,whatsapp_respuesta:whatsapp?(value("adminCallWhatsappRespuesta")||null):null,compromiso_pago:compromiso,fecha_compromiso:compromiso?id("adminCallFechaCompromiso").value:null,pago:pago,observaciones:value("adminCallObservaciones")||null,fecha_llamada:id("adminCallFecha").value};
    if(!row.cliente||!row.zona||!row.fecha_llamada){showToast("Completa todos los campos obligatorios.",true);return;}
    const {data,error}=await sbClient.from("llamadascr").insert(row).select(`*, perfilescr:asesor_id (id,nombre,apellido,zona,email,activo)`).single();
    if(error){console.error(error);showToast(error.message||"No fue posible registrar la llamada.",true);return;}
    e.target.reset();setAdminCallTodayDefault();toggleAdminWhatsappFields();toggleAdminCompromisoField();
    calls.unshift(data);cacheInvalidatePrefix("calls:");cacheInvalidatePrefix("dashboard:cartera:");dashboardCartera=await loadMonthlyDashboard(true);populateAdminFilters();renderAdmin();updateAdminDashboard(dashboardCartera);showToast("Llamada registrada correctamente.");
  }
  function setAdminCallTodayDefault(){const x=id("adminCallFecha");if(x&&!x.value)x.value=getTodayISO();}

  async function setPago(callId,val){
    if(!currentProfile||currentProfile.rol!=="administrador")return;
    const {data,error}=await sbClient.from("llamadascr").update({pago:val}).eq("id",callId).select(`*,perfilescr:asesor_id (id,nombre,apellido,zona,email,activo)`).single();
    if(error){showToast("No fue posible actualizar el pago.",true);return;} cacheInvalidatePrefix("calls:");cacheInvalidatePrefix("dashboard:cartera:");dashboardCartera=await loadMonthlyDashboard(true); updateCallLocal(data); showToast(val?"Marcado como pagado.":"Marcado como no pagado.");
  }
  function updateCallLocal(data){const i=calls.findIndex(x=>x.id===data.id);if(i>=0)calls[i]=data;renderAdmin();updateAdminDashboard(dashboardCartera);}
  async function deleteCall(callId){if(!confirm("¿Eliminar definitivamente esta llamada? Esta acción no se puede deshacer."))return;const {error}=await sbClient.from("llamadascr").delete().eq("id",callId);if(error){showToast("No fue posible eliminar la llamada. Verifica las políticas RLS.",true);return;}calls=calls.filter(x=>x.id!==callId);cacheInvalidatePrefix("calls:");cacheInvalidatePrefix("dashboard:cartera:");dashboardCartera=await loadMonthlyDashboard(true);renderAdmin();updateAdminDashboard(dashboardCartera);showToast("Llamada eliminada.");}

  function buildSidebar(){const nav=id("sidebar-nav");const admin=currentProfile?.rol==="administrador";const items=admin?[ ["admin-dashboard","▦","Dashboard"],["vista-admin","＋","Registrar llamada","form"],["vista-admin","▤","Ver llamadas","report"],["vista-encuestas-hub","☑","Encuestas"],["vista-usuarios","＋","Registrar asesor","form"],["vista-usuarios","▤","Reporte asesores","report"],["vista-configuracion","⚙","Configuración"],["vista-respaldo","⭳","Respaldo"] ]:[["vista-asesor","▦","Mi dashboard"],["vista-asesor","＋","Registrar llamada"],["vista-asesor","▤","Mis llamadas"],["vista-encuestas-hub","☑","Encuestas"]];nav.innerHTML=items.map(([target,icon,label,mode])=>`<button class="nav-item" type="button" data-target="${target}" data-mode="${mode||''}" data-anchor="${target==='vista-asesor'?label:''}"><span>${icon}</span>${label}</button>`).join("");nav.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",async()=>{showView(b.dataset.target);if(b.dataset.mode)setSectionMode(b.dataset.target,b.dataset.mode);if(currentProfile?.rol==="administrador"&&(b.dataset.mode==="report"||b.dataset.target==="vista-encuestas-hub")){await loadReportAdvisors();advisors=reportAdvisors.slice();populateAdminFilters();populateSurveyFilters();populateSurveyAdvisorSelects();}if(b.dataset.anchor==="Registrar llamada")id("asesor-form-section").scrollIntoView({behavior:"smooth"});if(b.dataset.anchor==="Mis llamadas")document.querySelector("#vista-asesor .table-card").scrollIntoView({behavior:"smooth"});closeSidebar();}));applyRoleVisibility();}
  function applyRoleVisibility(){const admin=currentProfile?.rol==="administrador";document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",!admin));}
  function closeSidebar(){id("sidebar").classList.remove("open");}

  function updateSessionHeader(){const name=[currentProfile?.nombre,currentProfile?.apellido].filter(Boolean).join(" ")||"Usuario", role=currentProfile?.rol==="administrador"?"Administrador":"Asesor";id("user-name").textContent=name;id("user-role").textContent=role;id("user-avatar").textContent=name.charAt(0).toUpperCase();id("sidebar-user-name").textContent=name;id("sidebar-user-role").textContent=role;id("session-area").classList.remove("hidden");id("btn-menu").classList.remove("hidden");id("sidebar").classList.remove("hidden");}
  function applyAdvisorProfile(){const select=id("zona");if(select){select.innerHTML=`<option value="">Seleccione la zona...</option>`+ZONAS.map(z=>`<option value="${escapeHTML(z)}">${escapeHTML(z)}</option>`).join("");select.value="";}id("asesor-zone-badge").textContent="Zona de trabajo: cualquier zona";id("asesor-welcome").textContent="Registra llamadas y selecciona la zona correspondiente en cada gestión.";}

  function getFilteredAsesorCalls(){const filtro=value("filtroAsesor").toLowerCase(),from=value("filtroAsesorDesde"),to=value("filtroAsesorHasta");const source=(from||to)&&Array.isArray(advisorFilteredCalls)?advisorFilteredCalls:calls;return source.filter(c=>{const matchText=[c.cliente,c.llamada,c.zona,c.observaciones,c.tipo_gestion].join(" ").toLowerCase().includes(filtro);const matchFrom=!from||c.fecha_llamada>=from;const matchTo=!to||c.fecha_llamada<=to;return matchText&&matchFrom&&matchTo;});}
  async function clearAsesorFilters(){id("filtroAsesor").value="";id("filtroAsesorDesde").value="";id("filtroAsesorHasta").value="";advisorFilteredCalls=null;const recent=await loadRecentAdvisorData();calls=recent.calls;renderAdvisorTable();}
  function renderAdvisorTable(){const tabla=id("tabla-asesor"),filtered=getFilteredAsesorCalls();tabla.innerHTML=filtered.length?filtered.map(c=>`<tr><td>#${c.id}</td><td>${escapeHTML(c.cliente)}</td><td>${llamadaBadge(c.llamada)}</td><td>${tipoGestionBadge(c.tipo_gestion)}</td><td>${escapeHTML(c.zona)}</td><td>${whatsappBadge(c)}</td><td>${compromisoCell(c)}</td><td>${pagoBadge(c.pago)}</td><td>${formatDate(c.fecha_llamada)}</td></tr>`).join(""):`<tr class="empty-row"><td colspan="9">${calls.length?"No se encontraron llamadas con los filtros seleccionados.":"No hay llamadas registradas."}</td></tr>`;updateAdvisorStats();}
  function updateAdvisorStats(){
    const list=Array.isArray(dashboardCartera?.asesores)?dashboardCartera.asesores:[];
    const mine=list.find(a=>a.id===currentProfile?.id||a.id===currentUser?.id||String(a.email||"").toLowerCase()===String(currentUser?.email||"").toLowerCase());
    // Las tarjetas del asesor representan el acumulado mensual individual, no el total global.
    const total=Number(mine?.realizadas)||0;
    const contestadas=Number(mine?.contestadas)||0;
    const no=Number(mine?.no_contestadas)||0;
    const pagos=Number(mine?.pagos)||0;
    const compromisos=Number(mine?.compromisos)||0;
    id("asesor-total-count").textContent=total;id("asesor-contestadas-count").textContent=contestadas;id("asesor-nocontestadas-count").textContent=no;id("asesor-pagos-count").textContent=pagos;id("asesor-compromisos-count").textContent=compromisos;
    const meta=Number(mine?.meta)||metaDe(currentProfile),pct=metaPct(total,meta);setText("asesor-meta-count",meta);setText("asesor-meta-pct",`${pct}%`);const bar=id("asesor-meta-bar");if(bar)bar.style.width=`${Math.min(100,pct)}%`;
  }
  function metaDe(p){const n=Number(p?.meta_mensual ?? p?.meta_llamadas);return Number.isFinite(n)&&n>0?n:META_POR_DEFECTO;}
  function metaPct(hechas,meta){return meta>0?Math.round(hechas/meta*100):0;}
  function updateAdvisorDashboard(){updateAdvisorStats();}

  function renderAdmin(){const filtered=getFilteredAdminCalls();const summaryBody=id("tabla-admin");const detailBody=id("tabla-admin-detail");const by={};filtered.forEach(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—";const k=c.asesor_id||name;if(!by[k])by[k]={name,total:0,contestadas:0,no:0,whatsapp:0,compromisos:0,pagos:0,zones:new Set()};const g=by[k];g.total++;if(c.llamada==="Contestada")g.contestadas++;if(c.llamada==="No contestada")g.no++;if(c.whatsapp_enviado)g.whatsapp++;if(c.compromiso_pago)g.compromisos++;if(c.pago)g.pagos++;if(c.zona)g.zones.add(c.zona);});const rows=Object.values(by).sort((a,b)=>b.total-a.total);if(summaryBody)summaryBody.innerHTML=rows.length?rows.map(g=>`<tr><td><strong>${escapeHTML(g.name)}</strong></td><td>${g.total}</td><td><span class="metric-pill metric-ok">${g.contestadas}</span></td><td><span class="metric-pill metric-no">${g.no}</span></td><td><span class="metric-pill metric-wa">${g.whatsapp}</span></td><td>${g.compromisos}</td><td>${g.pagos}</td><td>${escapeHTML([...g.zones].join(", ")||"—")}</td></tr>`).join(""):'<tr class="empty-row"><td colspan="8">No hay llamadas con los filtros seleccionados.</td></tr>';if(detailBody)detailBody.innerHTML=filtered.length?filtered.map(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||"—";return `<tr><td>#${c.id}</td><td>${escapeHTML(name)}</td><td>${escapeHTML(c.cliente)}</td><td>${llamadaBadge(c.llamada)}</td><td>${tipoGestionBadge(c.tipo_gestion)}</td><td>${escapeHTML(c.zona)}</td><td>${whatsappBadge(c)}</td><td>${compromisoCell(c)}</td><td class="action-cell">${pagoBadge(c.pago)}<button class="btn-small" onclick="setPago(${c.id},${!c.pago})">${c.pago?"Quitar pago":"Marcar pago"}</button></td><td>${formatDate(c.fecha_llamada)}</td><td class="action-cell"><button class="btn-delete" onclick="deleteCall(${c.id})">Eliminar</button></td></tr>`;}).join(""):'<tr class="empty-row"><td colspan="11">No hay llamadas registradas.</td></tr>';setText("admin-result-count",`${filtered.length} llamada${filtered.length===1?"":"s"}`);renderSeguimientoAdmin();}
   function getFilteredAdminCalls(){const text=value("filtroAdminTexto").toLowerCase(),llamada=id("filtroLlamadaAdmin").value,tipoGestion=id("filtroTipoGestionAdmin").value,compromiso=id("filtroCompromisoAdmin").value,pago=id("filtroPagoAdmin").value,zona=id("filtroZonaAdmin").value,from=id("filtroDesdeAdmin").value,to=id("filtroHastaAdmin").value;return (reportCalls||calls).filter(c=>{const a=c.perfilescr||{},search=[a.nombre,a.apellido,a.email,c.cliente,c.zona,c.observaciones,c.llamada,c.tipo_gestion].join(" ").toLowerCase();return(!text||search.includes(text))&&(!asesoresSeleccionados.length||asesoresSeleccionados.includes(c.asesor_id))&&(!llamada||(llamada==="__SIN_ESPECIFICAR__"?!c.llamada:c.llamada===llamada))&&(!tipoGestion||c.tipo_gestion===tipoGestion)&&(!compromiso||String(c.compromiso_pago)===compromiso)&&(!pago||String(c.pago)===pago)&&(!zona||c.zona===zona)&&(!from||c.fecha_llamada>=from)&&(!to||c.fecha_llamada<=to);});}
  function populateAdminFilters(){const advisorSource=reportAdvisors.length?reportAdvisors:advisors;const zone=id("filtroZonaAdmin"),zVal=zone.value;zone.innerHTML='<option value="">Todas las zonas</option>'+ZONAS.map(z=>`<option>${escapeHTML(z)}</option>`).join("");zone.value=zVal;const tg=id("filtroTipoGestionAdmin"),tgVal=tg.value;tg.innerHTML='<option value="">Todos</option>'+TIPOS_GESTION.map(t=>`<option>${escapeHTML(t)}</option>`).join("");tg.value=tgVal;asesoresSeleccionados=asesoresSeleccionados.filter(id=>advisorSource.some(a=>a.id===id));syncAsesoresChecklist(advisorSource);}
  function syncAsesoresChecklist(source=null){
    const list=id("ms-asesores-list"); if(!list)return;
    const advisorSource=source || (reportAdvisors.length ? reportAdvisors : advisors);
    list.innerHTML=advisorSource.map(a=>{const nombre=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email;const checked=asesoresSeleccionados.includes(a.id)?"checked":"";return `<label class="multiselect-option"><input type="checkbox" value="${a.id}" ${checked}> ${escapeHTML(nombre)}</label>`;}).join("")||'<p class="muted">No hay asesores registrados.</p>';
    list.querySelectorAll('input[type="checkbox"]').forEach(chk=>chk.addEventListener("change",()=>{
      const id_=chk.value;
      if(chk.checked){if(!asesoresSeleccionados.includes(id_))asesoresSeleccionados.push(id_);}else{asesoresSeleccionados=asesoresSeleccionados.filter(x=>x!==id_);}
      updateAsesoresToggleLabel();renderAdmin();
    }));
    updateAsesoresToggleLabel();
  }
  function updateAsesoresToggleLabel(){
    const btn=id("ms-asesores-toggle"); if(!btn)return;
    if(!asesoresSeleccionados.length){btn.textContent="Todos los asesores";return;}
    if(asesoresSeleccionados.length===1){const a=(reportAdvisors.length?reportAdvisors:advisors).find(x=>x.id===asesoresSeleccionados[0]);btn.textContent=a?([a.nombre,a.apellido].filter(Boolean).join(" ")||a.email):"1 asesor seleccionado";return;}
    btn.textContent=`${asesoresSeleccionados.length} asesores seleccionados`;
  }
  function nombreAsesor(a){return [a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Sin asesor";}
  function asesoresComparadosTexto(){const source=reportAdvisors.length?reportAdvisors:advisors;return asesoresSeleccionados.length?source.filter(a=>asesoresSeleccionados.includes(a.id)).map(nombreAsesor).join(", "):"Todos los asesores";}

  function updateAdminDashboard(dashboard=null){
    const d=dashboard||{};
    const total=Number(d.total)||0,contestadas=Number(d.contestadas)||0,no=Number(d.no_contestadas)||0,compromisos=Number(d.compromisos)||0,pagos=Number(d.pagos)||0;
    setText("dash-total",total);setText("dash-contestadas",contestadas);setText("dash-nocontestadas",no);setText("dash-compromisos",compromisos);setText("dash-pagos",pagos);
    const dashboardAdvisors=Array.isArray(d.asesores)?d.asesores:[];
    const metaTotal=dashboardAdvisors.reduce((acc,a)=>acc+metaDe(a),0);
    const hechas=dashboardAdvisors.reduce((acc,a)=>acc+(Number(a.realizadas)||0),0);
    const adminPct=metaPct(hechas,metaTotal);
    setText("dash-admin-goal",metaTotal);setText("dash-admin-goal-done",hechas);setText("dash-admin-goal-pct",`${adminPct}%`);
    const bar=id("dash-admin-goal-bar");if(bar)bar.style.width=`${Math.min(100,adminPct)}%`;
    const now=new Date();setText("dash-admin-goal-month",new Date(now.getFullYear(),now.getMonth(),1).toLocaleDateString("es-CO",{month:"long",year:"numeric"}));
    id("dash-goals-list").innerHTML=dashboardAdvisors.map(a=>{const n=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email,count=Number(a.realizadas)||0,meta=metaDe(a),pct=metaPct(count,meta);return `<div class="goal-chart-row"><div class="goal-chart-head"><strong>${escapeHTML(n)}</strong><span>${count} de ${meta} llamadas · ${pct}%</span></div><div class="goal-track"><i style="width:${Math.min(100,pct)}%"></i></div></div>`;}).join("")||'<p class="muted">No hay asesores registrados.</p>';
    const counts=[{t:"Contestadas",n:Number(d.contestadas)||0},{t:"No contestadas",n:Number(d.no_contestadas)||0},{t:"Equivocadas",n:Number(d.equivocadas)||0},{t:"Compromisos",n:Number(d.compromisos)||0},{t:"Pagos",n:Number(d.pagos)||0}];const max=Math.max(1,...counts.map(x=>x.n));id("dash-services-list").innerHTML=counts.map(x=>`<div class="mini-bar-row"><span>${x.t}</span><div><i style="width:${x.n/max*100}%"></i></div><strong>${x.n}</strong></div>`).join("");
    const gestion=d.gestion&&typeof d.gestion==="object"?d.gestion:{};const gestionCounts=TIPOS_GESTION.map(t=>({t,n:Number(gestion[t])||0}));const gestionMax=Math.max(1,...gestionCounts.map(x=>x.n));id("dash-gestion-list").innerHTML=gestionCounts.map(x=>`<div class="mini-bar-row"><span title="${escapeHTML(x.t)}">${escapeHTML(TIPOS_GESTION_CORTO[x.t]||x.t)}</span><div><i style="width:${x.n/gestionMax*100}%"></i></div><strong>${x.n}</strong></div>`).join("");
  }

  function clearAdvisorSearch(){
    const input=id("buscar-asesor");
    if(input) input.value="";
    advisors=[];
    renderUsers();
  }
  function searchAdvisors(){
    const input=id("buscar-asesor");
    if(!input)return;
    clearTimeout(advisorSearchTimer);
    const term=input.value.trim();
    if(!term){advisors=[];renderUsers();return;}
    advisorSearchTimer=setTimeout(async()=>{
      try{
        const safe=term.replace(/,/g," ").trim();
        const key=`advisors:search:${safe.toLowerCase()}`;
        advisors=await cachedQuery(key,()=>sbClient.from("perfilescr").select("*").eq("rol","asesor").or(`nombre.ilike.%${safe}%,apellido.ilike.%${safe}%,email.ilike.%${safe}%,documento.ilike.%${safe}%`).order("nombre",{ascending:true}).order("apellido",{ascending:true}).limit(20).then(r=>{if(r.error)throw r.error;return r.data||[];}));
        renderUsers();
      }catch(error){console.error(error);showToast("No fue posible buscar asesores.",true);}
    },350);
  }
  async function loadReportAdvisors(){
    const res=await cachedQuery("advisors:report",()=>sbClient.from("perfilescr").select("*").eq("rol","asesor").order("nombre",{ascending:true}).order("apellido",{ascending:true}).then(r=>{if(r.error)throw r.error;return r.data||[];}));
    reportAdvisors=Array.isArray(res)?res:[];
    return reportAdvisors;
  }

  function renderUsers(){const tbody=id("tabla-usuarios");if(!tbody)return;tbody.innerHTML=advisors.map(a=>{const name=[a.nombre,a.apellido].filter(Boolean).join(" ")||"—";const meta=metaDe(a),da=Array.isArray(dashboardCartera?.asesores)?dashboardCartera.asesores.find(x=>x.id===a.id):null,hechas=Number(da?.realizadas)||0,pct=metaPct(hechas,meta);return `<tr><td><strong>${escapeHTML(name)}</strong></td><td>${escapeHTML(a.email||"—")}</td><td>${meta}</td><td>${hechas}</td><td><div class="mini-progress"><span style="width:${Math.min(100,pct)}%"></span></div><small>${pct}%</small></td><td>${a.activo===false?'<span class="badge badge-disabled">Inhabilitado</span>':'<span class="badge badge-active">Activo</span>'}</td><td class="action-cell"><button class="btn-small" onclick="editAdvisor('${a.id}')">Editar</button><button class="btn-small" onclick="toggleAdvisor('${a.id}',${a.activo!==false})">${a.activo===false?"Habilitar":"Inhabilitar"}</button><button class="btn-delete" onclick="deleteAdvisor('${a.id}')">Eliminar</button></td></tr>`;}).join("")||'<tr class="empty-row"><td colspan="7">No hay asesores registrados.</td></tr>';}

  function resetAdminSurveyForm(){
    const form=id("admin-survey-form"); if(form)form.reset();
  }

  async function loadSurveyCalls(search=""){
    if(!currentUser)return;
    let q=sbClient.from("llamadascr").select("id,cliente,llamada,tipo_gestion,zona,fecha_llamada,observaciones,asesor_id").order("fecha_llamada",{ascending:false}).order("id",{ascending:false}).limit(30);
    if(currentProfile?.rol!=="administrador") q=q.eq("asesor_id",currentUser.id);
    if(search.trim()) q=q.ilike("cliente",`%${search.trim()}%`);
    const {data,error}=await q;
    if(error){console.error(error);showToast("No fue posible cargar las llamadas para asociar la encuesta.",true);return;}
    const select=id("adminEncLlamada"); if(!select)return;
    const current=select.value;
    select.innerHTML='<option value="">Seleccione una llamada...</option>'+((data||[]).map(c=>`<option value="${c.id}">${escapeHTML(c.fecha_llamada||"—")} · ${escapeHTML(c.cliente||"—")} · ${escapeHTML(c.tipo_gestion||"Sin gestión")}</option>`).join(""));
    if(current && (data||[]).some(c=>String(c.id)===String(current)))select.value=current;
    select._callData=data||[];
  }
  function toggleSurveyCallMode(){
    const linked=value("adminEncOrigen")==="llamada";
    id("adminEncLlamadaGroup")?.classList.toggle("hidden",!linked);
    id("adminEncLlamadaSearchGroup")?.classList.toggle("hidden",!linked);
    id("adminEncLlamadaInfo")?.classList.toggle("hidden",!linked);
    if(!linked){ id("adminEncLlamada").value=""; id("adminEncLlamadaSearch").value=""; id("adminEncLlamada")._callData=[]; id("adminEncLlamadaInfo").textContent="Encuesta puerta a puerta/directa: no requiere una llamada previa."; }
    else { id("adminEncLlamadaInfo").textContent="Seleccione una llamada existente para copiar automáticamente fecha, cliente, zona, tipo de llamada, gestión y observaciones al reporte."; loadSurveyCalls(); }
  }
  function applySelectedSurveyCall(){
    const select=id("adminEncLlamada"), calls=select?select._callData||[]:[], c=calls.find(x=>String(x.id)===String(select?.value));
    if(!c)return;
    id("adminEncCodigoUsuario").value=c.cliente||"";
    id("adminEncZona").value=c.zona||"";
    id("adminEncCodigoUsuario").readOnly=true;
    id("adminEncZona").disabled=true;
    id("adminEncFechaLlamada").value=c.fecha_llamada||"";
    id("adminEncTipoGestion").value=c.tipo_gestion||"";
    id("adminEncTipoLlamada").value=c.llamada||"";
    id("adminEncObservacionLlamada").value=c.observaciones||"";
  }
  function resetSurveyCallFields(){
    id("adminEncCodigoUsuario").readOnly=false; id("adminEncZona").disabled=false;
    ["adminEncFechaLlamada","adminEncTipoGestion","adminEncTipoLlamada","adminEncObservacionLlamada"].forEach(k=>{if(id(k))id(k).value="";});
  }
  function resetAdminSurveyForm(){ const form=id("admin-survey-form"); if(form)form.reset(); resetSurveyCallFields(); toggleSurveyCallMode(); }

  async function saveAdminSurvey(e){
    e.preventDefault();
    if(!currentUser||!currentProfile){showToast("Tu sesión no está disponible.",true);return;}
    const linked=value("adminEncOrigen")==="llamada";
    const selectedId=linked?value("adminEncLlamada"):null;
    const selectedCall=linked?(id("adminEncLlamada")?._callData||[]).find(c=>String(c.id)===String(selectedId)):null;
    if(linked&&!selectedCall){showToast("Selecciona una llamada existente o cambia a encuesta directa/puerta a puerta.",true);return;}
    const zona=selectedCall?.zona||value("adminEncZona")||null;
    if(!value("adminEncCodigoUsuario")||!zona){showToast("Completa el cliente/usuario y la zona.",true);return;}
    const enc={
      llamada_id:selectedCall?.id||null, asesor_id:currentUser.id, codigo_usuario:value("adminEncCodigoUsuario")||null, zona,
      calificacion_servicio:value("adminEncServicio")||null, observacion_servicio:value("adminEncServicioObs")||null,
      calificacion_tecnica:value("adminEncTecnica")||null, observacion_tecnica:value("adminEncTecnicaObs")||null,
      calificacion_administrativa:value("adminEncAdministrativa")||null, observacion_administrativa:value("adminEncAdministrativaObs")||null,
      agilidad_averias:value("adminEncAverias")||null, recomendaria:value("adminEncRecomendaria")||null, recomendacion_felicitacion:value("adminEncRecomendacion")||null
    };
    setButtonBusy(e.submitter,true,"Guardando...");
    const {data,error}=await sbClient.from("encuestascr").insert(enc).select(SURVEY_SELECT).single();
    setButtonBusy(e.submitter,false,"Guardar encuesta");
    if(error){console.error(error);showToast(error.message||"No fue posible guardar la encuesta.",true);return;}
    surveys.unshift(data); reportSurveys=null; cacheInvalidatePrefix("surveys:"); populateSurveyFilters(); renderSurveys(); resetAdminSurveyForm(); showToast(selectedCall?"Encuesta guardada y vinculada a la llamada.":"Encuesta directa/puerta a puerta guardada correctamente.");
  }


  async function saveSeguimientoSurvey(e){e.preventDefault();const row={usuario:value("segUsuario"),zona:value("segZona")||null,como_se_entero:value("segEntero")||null,fechas_pago:value("segFechas"),medio_contrato:value("segContrato"),atencion_asesor:value("segAtencion"),redes_sociales:value("segRedes"),cobro_tecnico:value("segTecnica"),medios_pago:value("segMedios"),asesor_id:currentUser.id};const {data,error}=await sbClient.from("encuestas_seguimientocr").insert(row).select().single();if(error){showToast(error.message,true);return;}seguimientoSurveys.unshift(data);cacheInvalidatePrefix("seguimiento:");renderSeguimientoSurveys();e.target.reset();showToast("Encuesta de seguimiento guardada.");}
  async function saveServicioSurvey(e){e.preventDefault();const row={usuario:value("srvUsuario"),zona:value("srvZona")||null,servicio_retirado:value("srvServicio"),motivo_retiro:value("srvMotivo")||null,interes_retomar:value("srvRetomar"),observaciones:value("srvObservaciones")||null,asesor_id:currentUser.id};const {data,error}=await sbClient.from("encuestas_serviciocr").insert(row).select().single();if(error){showToast(error.message,true);return;}servicioSurveys.unshift(data);cacheInvalidatePrefix("servicio:");renderServicioSurveys();e.target.reset();showToast("Encuesta de servicio guardada.");}
  function renderSeguimientoSurveys(){const t=id("tabla-seguimiento-encuesta");if(!t)return;t.innerHTML=seguimientoSurveys.map(x=>`<tr><td>${escapeHTML(x.usuario)}</td><td>${escapeHTML(x.zona||"—")}</td><td>${escapeHTML(x.como_se_entero||"—")}</td><td>${escapeHTML(x.fechas_pago)}</td><td>${escapeHTML(x.medio_contrato)}</td><td>${escapeHTML(x.atencion_asesor)}</td><td>${escapeHTML(x.redes_sociales)}</td><td>${escapeHTML(x.cobro_tecnico)}</td><td>${escapeHTML(x.medios_pago)}</td><td>${formatDate(x.created_at?.slice(0,10))}</td></tr>`).join("")||'<tr class="empty-row"><td colspan="10">No hay encuestas registradas.</td></tr>';}
  function renderServicioSurveys(){const t=id("tabla-servicio-encuesta");if(!t)return;t.innerHTML=servicioSurveys.map(x=>`<tr><td>${escapeHTML(x.usuario)}</td><td>${escapeHTML(x.zona||"—")}</td><td>${escapeHTML(x.servicio_retirado)}</td><td>${escapeHTML(x.motivo_retiro||"—")}</td><td>${escapeHTML(x.interes_retomar)}</td><td>${escapeHTML(x.observaciones||"—")}</td><td>${formatDate(x.created_at?.slice(0,10))}</td></tr>`).join("")||'<tr class="empty-row"><td colspan="7">No hay encuestas registradas.</td></tr>';}
  function downloadSimpleCSV(name,rows){if(!rows.length){showToast("No hay datos para exportar.",true);return;}const keys=Object.keys(rows[0]).filter(k=>!["id","asesor_id"].includes(k));const csv=[keys.join(","),...rows.map(r=>keys.map(k=>`"${String(r[k]??"").replaceAll('"','""')}"`).join(","))].join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download=`reporte_${name}.csv`;a.click();}

  async function saveAdminUser(e){e.preventDefault();const idUser=id("admin-user-id").value;const body={nombre:value("admin-user-nombre"),apellido:value("admin-user-apellido"),documento:value("admin-user-documento"),telefono:value("admin-user-telefono"),zona:"",email:value("admin-user-email"),meta_mensual:Math.max(0,parseInt(id("admin-user-meta").value,10)||META_POR_DEFECTO)};if(!idUser){const password=id("admin-user-password").value;if(password.length<6){showToast("La contraseña debe tener mínimo 6 caracteres.",true);return;}const {data,error}=await fetchAdminFunction("create",{...body,password});if(error){showToast(error,true);return;}showToast("Asesor creado correctamente.");resetUserForm();cacheInvalidate("advisors:all");cacheInvalidate("advisors:report");cacheInvalidatePrefix("dashboard:cartera:");await loadAdminData(true);return;}const result=await fetchAdminFunction("update",{user_id:idUser,...body});if(result.error){showToast(result.error,true);return;}showToast("Asesor actualizado.");resetUserForm();cacheInvalidate("advisors:all");cacheInvalidate("advisors:report");cacheInvalidatePrefix("dashboard:cartera:");await loadAdminData(true);}
  async function fetchAdminFunction(action,payload){const {data:{session}}=await sbClient.auth.getSession();if(!session)return{error:"Sesión no disponible."};try{const r=await fetch(`${SUPABASE_URL}/functions/v1/admin-users-cr`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...payload})});const j=await r.json().catch(()=>({}));return r.ok?{data:j}:{error:j.error||`Error ${r.status}`};}catch(e){return{error:"No se pudo contactar la función de administración. Debes desplegar supabase/functions/admin-users-cr."};}}
  function editAdvisor(uid){const a=advisors.find(x=>x.id===uid);if(!a)return;id("admin-user-id").value=a.id;["nombre","apellido","documento","telefono","email"].forEach(k=>id(`admin-user-${k}`).value=a[k]||"");id("admin-user-meta").value=metaDe(a);id("admin-user-password").value="";id("btn-save-user").textContent="Actualizar asesor";id("btn-cancel-user-edit").classList.remove("hidden");setSectionMode("vista-usuarios","form");document.getElementById("vista-usuarios").scrollIntoView({behavior:"smooth"});}
  function resetUserForm(){id("admin-user-form").reset();id("admin-user-id").value="";id("admin-user-meta").value=META_POR_DEFECTO;id("btn-save-user").textContent="Crear asesor";id("btn-cancel-user-edit").classList.add("hidden");}
  async function toggleAdvisor(uid,active){const {error}=await sbClient.from("perfilescr").update({activo:!active}).eq("id",uid);if(error){showToast(error.message,true);return;}showToast(active?"Asesor inhabilitado.":"Asesor habilitado.");cacheInvalidate("advisors:all");cacheInvalidate("advisors:report");cacheInvalidatePrefix("dashboard:cartera:");await loadAdminData(true);}
  async function deleteAdvisor(uid){const a=advisors.find(x=>x.id===uid);if(!a)return;if(!confirm(`¿Eliminar a ${[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email}? Solo se podrá eliminar si no tiene llamadas registradas.`))return;const result=await fetchAdminFunction("delete",{user_id:uid});if(result.error){showToast(result.error,true);return;}showToast("Asesor eliminado.");cacheInvalidate("advisors:all");cacheInvalidate("advisors:report");cacheInvalidatePrefix("dashboard:cartera:");await loadAdminData(true);}

  async function saveConfig(e){e.preventDefault();let logo=config.logo_url||"";const file=id("config-logo").files[0];if(file){if(file.size>2*1024*1024){showToast("La imagen debe pesar máximo 2 MB.",true);return;}const ext=(file.name.split(".").pop()||"png").toLowerCase();const path=`cartera/logo-${Date.now()}.${ext}`;const {error:upErr}=await sbClient.storage.from("app-assets").upload(path,file,{cacheControl:"31536000",upsert:true,contentType:file.type});if(upErr){showToast(upErr.message,true);return;}const {data:pub}=sbClient.storage.from("app-assets").getPublicUrl(path);logo=pub.publicUrl;}const color=id("config-color").value;const {error}=await sbClient.from("configuracioncr").upsert({id:1,color_principal:color,logo_url:logo,updated_by:currentUser.id},{onConflict:"id"});if(error){showToast(error.message,true);return;}config={color_principal:color,logo_url:logo};cacheInvalidate("config:cartera");applyTheme();renderConfig();showToast("Configuración guardada.");}
  async function removeLogo(){const {error}=await sbClient.from("configuracioncr").upsert({id:1,color_principal:config.color_principal,logo_url:"",updated_by:currentUser.id},{onConflict:"id"});if(error){showToast(error.message,true);return;}config.logo_url="";cacheInvalidate("config:cartera");renderConfig();showToast("Imagen retirada del reporte.");}
  function renderConfig(){id("config-color").value=config.color_principal||"#0ea5e9";id("logo-preview").innerHTML=config.logo_url?`<img src="${config.logo_url}" alt="Logo de empresa">`:'<span>LOGO</span>';}
  function applyTheme(){document.documentElement.style.setProperty("--purple-primary",config.color_principal||"#0ea5e9");}

  function clearAdminFilters(){reportCalls=null;["filtroAdminTexto","filtroLlamadaAdmin","filtroTipoGestionAdmin","filtroCompromisoAdmin","filtroPagoAdmin","filtroZonaAdmin","filtroDesdeAdmin","filtroHastaAdmin"].forEach(x=>id(x).value="");asesoresSeleccionados=[];syncAsesoresChecklist();renderAdmin();}

  function groupByClient(list){const map={};list.forEach(c=>{if(!map[c.cliente])map[c.cliente]={total:0,contestadas:0,nocontestadas:0,compromisos:0,pagos:0,asesores:new Set()};const g=map[c.cliente];g.total++;if(c.llamada==="Contestada")g.contestadas++;if(c.llamada==="No contestada")g.nocontestadas++;if(c.compromiso_pago)g.compromisos++;if(c.pago)g.pagos++;const a=c.perfilescr;if(a)g.asesores.add([a.nombre,a.apellido].filter(Boolean).join(" ")||a.email);});return map;}
  function renderSeguimientoAsesor(){const now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`,monthly=calls.filter(c=>c.fecha_llamada?.startsWith(ym));const map=groupByClient(monthly);const rows=Object.entries(map).sort((a,b)=>b[1].total-a[1].total);const tbody=id("tabla-seguimiento-asesor");if(!tbody)return;tbody.innerHTML=rows.length?rows.map(([cliente,g])=>`<tr><td>${escapeHTML(cliente)}</td><td>${g.total}</td><td>${g.contestadas}</td><td>${g.nocontestadas}</td><td>${g.compromisos}</td><td>${g.pagos}</td></tr>`).join(""):'<tr class="empty-row"><td colspan="6">No hay llamadas este mes.</td></tr>';}
  function renderSeguimientoAdmin(){const filtered=getFilteredAdminCalls();const map=groupByClient(filtered);const rows=Object.entries(map).sort((a,b)=>b[1].total-a[1].total);const tbody=id("tabla-seguimiento-admin");if(!tbody)return;tbody.innerHTML=rows.length?rows.map(([cliente,g])=>`<tr><td>${escapeHTML(cliente)}</td><td>${g.total}</td><td>${g.contestadas}</td><td>${g.nocontestadas}</td><td>${g.compromisos}</td><td>${g.pagos}</td><td>${escapeHTML([...g.asesores].join(", ")||"—")}</td></tr>`).join(""):'<tr class="empty-row"><td colspan="7">No hay llamadas con los filtros seleccionados.</td></tr>';}

  function metasResumen(list){
    const now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const monthly=(reportCalls||calls).filter(c=>c.fecha_llamada?.startsWith(ym));
    const metaSource=(reportAdvisors&&reportAdvisors.length)?reportAdvisors:advisors;
    return metaSource.filter(a=>a.activo!==false).map(a=>{
      const nombre=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—",meta=metaDe(a),hechas=monthly.filter(c=>c.asesor_id===a.id).length;
      return {nombre,meta,hechas,pct:metaPct(hechas,meta),pendientes:Math.max(0,meta-hechas)};
    }).sort((x,y)=>y.pct-x.pct);
  }
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

  // ---------------------------------------------------------------
  // Gráficos en SVG puro para PDF/impresión (html2canvas no renderiza
  // bien conic-gradient de CSS; SVG sí se rasteriza de forma fiable).
  // ---------------------------------------------------------------
  function svgDonut(segments, centerLabel, centerSub) {
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const r = 42, cx = 55, cy = 55, circumference = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segments.filter(s => s.value > 0).map(s => {
      const frac = s.value / total, dash = frac * circumference, gap = circumference - dash;
      const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="15" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += dash; return circle;
    }).join("");
    return `<svg viewBox="0 0 110 110" width="108" height="108">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#eee8f7" stroke-width="15"/>
      ${arcs}
      <text x="${cx}" y="${cy - 1}" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#3c3157">${escapeHTML(centerLabel)}</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-family="Arial" font-size="7" fill="#77717f">${escapeHTML(centerSub || "")}</text>
    </svg>`;
  }
  function donutCardHTML(title, segments, centerLabel, centerSub) {
    const legend = segments.map(s => `<span><i class="print-dot" style="background:${s.color}"></i>${escapeHTML(s.label)}<strong>${s.value}</strong></span>`).join("");
    return `<div class="print-chart-card"><h2>${escapeHTML(title)}</h2><div class="print-chart-figure">${svgDonut(segments, centerLabel, centerSub)}<div class="print-legend">${legend}</div></div></div>`;
  }
  function svgBarCompare(items, width) {
    const w = width || 520, leftW = 108, rightW = 34, barH = 15, gap = 8;
    const max = Math.max(1, ...items.map(i => Math.max(i.value, i.value2 || 0)));
    const chartW = w - leftW - rightW;
    const rowH = (items[0] && items[0].value2 !== undefined) ? barH * 2 + 4 : barH;
    const rows = items.map((it, i) => {
      const y = i * (rowH + gap);
      const w1 = Math.max(0, Math.round((it.value / max) * chartW));
      let extra = "";
      if (it.value2 !== undefined) {
        const w2 = Math.max(0, Math.round((it.value2 / max) * chartW));
        extra = `<rect x="${leftW}" y="${y + barH + 3}" width="${chartW}" height="${barH}" rx="4" fill="#efe9f8"/><rect x="${leftW}" y="${y + barH + 3}" width="${w2}" height="${barH}" rx="4" fill="#d7cdef"/><text x="${leftW + chartW + 6}" y="${y + barH + 3 + barH - 4}" font-family="Arial" font-size="8.5" font-weight="700" fill="#7659a9">${it.value2}</text>`;
      }
      return `<text x="0" y="${y + barH - 4}" font-family="Arial" font-size="8.5" fill="#3c3157">${escapeHTML(it.label)}</text>
        <rect x="${leftW}" y="${y}" width="${chartW}" height="${barH}" rx="4" fill="#efe9f8"/>
        <rect x="${leftW}" y="${y}" width="${w1}" height="${barH}" rx="4" fill="${it.color || "#8064b3"}"/>
        <text x="${leftW + chartW + 6}" y="${y + barH - 4}" font-family="Arial" font-size="8.5" font-weight="700" fill="#3c3157">${it.value}</text>
        ${extra}`;
    }).join("");
    const height = items.length ? items.length * (rowH + gap) - gap + 4 : 30;
    return items.length ? `<svg viewBox="0 0 ${w} ${height}" width="100%" height="${height}">${rows}</svg>` : '<p class="print-empty-chart">No hay datos para comparar.</p>';
  }
  function finalGoalBannerHTML(metaTotal, done, pct) {
    return `<div class="print-final-goal">
      <div class="print-final-goal-title"><span>META FINAL DEL ADMINISTRADOR</span><strong>Meta mensual del equipo de cartera</strong></div>
      <div class="print-final-goal-metric"><span>Realizadas</span><strong>${done}</strong></div>
      <div class="print-final-goal-metric"><span>Meta</span><strong>${metaTotal}</strong></div>
      <div class="print-final-goal-metric"><span>Cumplimiento</span><strong>${pct}%</strong></div>
      <div class="print-final-goal-track"><i style="width:${Math.min(100, pct)}%"></i></div>
    </div>`;
  }

  function buildReportHTML(){
    const filtered=getFilteredAdminCalls(),total=filtered.length,contestadas=filtered.filter(c=>c.llamada==="Contestada").length,no=filtered.filter(c=>c.llamada==="No contestada").length,equivocadas=filtered.filter(c=>c.llamada==="Equivocada").length,compromisos=filtered.filter(c=>c.compromiso_pago).length,pagos=filtered.filter(c=>c.pago).length;
    const now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`,monthlyCalls=calls.filter(c=>c.fecha_llamada?.startsWith(ym)),metaTotal=((reportAdvisors&&reportAdvisors.length)?reportAdvisors:advisors).filter(a=>a.activo!==false).reduce((acc,a)=>acc+metaDe(a),0),monthlyPct=metaPct(monthlyCalls.length,metaTotal);
    const desde=value("filtroDesdeAdmin"),hasta=value("filtroHastaAdmin"),period=desde||hasta?`${desde?formatDate(desde):"Inicio"} – ${hasta?formatDate(hasta):"Actual"}`:"Todos los periodos";
    const comparativo=advisorCallSummary(filtered).slice(0,8).map(g=>({label:g.name,value:g.total,color:"#8064b3"}));
    const gestionItems=TIPOS_GESTION.map(t=>({label:TIPOS_GESTION_CORTO[t]||t,value:filtered.filter(c=>c.tipo_gestion===t).length,color:"#0ea5e9"}));
    return `<div class="print-report-sheet compact-pdf">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">REPORTE DE CARTERA</span><h1>Llamadas de cobro</h1><p>Periodo: <strong>${escapeHTML(period)}</strong> · Asesores: <strong>${escapeHTML(asesoresComparadosTexto())}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total llamadas</span><strong>${total}</strong></div><div class="print-summary-card"><span>Contestadas</span><strong>${contestadas}</strong></div><div class="print-summary-card"><span>No contestadas</span><strong>${no}</strong></div><div class="print-summary-card"><span>Equivocadas</span><strong>${equivocadas}</strong></div><div class="print-summary-card"><span>Compromisos</span><strong>${compromisos}</strong></div><div class="print-summary-card"><span>Pagos</span><strong>${pagos}</strong></div></div><section class="print-charts">${donutCardHTML("Tipo de llamada",LLAMADA_REPORT_TYPES.map((label,index)=>({label,value:filtered.filter(c=>(c.llamada||"Sin especificar")===label).length,color:["#2ecc71","#e74c3c","#f1c40f","#3498db","#9b59b6","#95a5a6"][index]})),total,"total")}${donutCardHTML("Compromisos y pagos",[{label:"Pagos",value:pagos,color:"#2ecc71"},{label:"Compromisos",value:compromisos,color:"#8064b3"}],`${total?Math.round(pagos/total*100):0}%`,"pagaron")}<div class="print-chart-card"><h2>Comparativo por asesor</h2>${svgBarCompare(comparativo)}</div><div class="print-chart-card" style="grid-column:1 / -1"><h2>Tipo de llamada</h2>${svgBarCompare(gestionItems,900)}</div></section>${finalGoalBannerHTML(metaTotal,monthlyCalls.length,monthlyPct)}</div>`;
  }
  function previewReport(builder=buildReportHTML){const modal=id("report-preview-modal"),content=id("report-preview-content");if(!modal||!content){showToast("No se encontró el visor de reportes.",true);return;}try{content.innerHTML=builder();modal.classList.remove("hidden");modal.setAttribute("aria-hidden","false");document.body.classList.add("report-preview-open");}catch(e){console.error(e);showToast("No fue posible preparar la vista previa.",true);}}
  function closeReportPreview(){const modal=id("report-preview-modal");if(!modal)return;modal.classList.add("hidden");modal.setAttribute("aria-hidden","true");document.body.classList.remove("report-preview-open");}
  function printReport(builder=buildReportHTML){try{const html=builder();const w=window.open("","_blank","width=1200,height=850");if(!w){showToast("El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para este sitio.",true);return;}const css=document.querySelector('link[href*="styles.css"]');w.document.open();w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Reporte de cartera</title>${css?`<link rel="stylesheet" href="${css.href}">`:""}<style>body{margin:0;background:#fff;color:#252334}.print-report-sheet{display:block!important;max-width:none!important;box-shadow:none!important}.print-table-scroll{overflow:visible!important} @page{size:A4 landscape;margin:10mm}</style></head><body>${html}</body></html>`);w.document.close();w.focus();setTimeout(()=>{w.print();setTimeout(()=>w.close(),700);},500);}catch(e){console.error(e);showToast("No fue posible abrir la impresión.",true);}}
  async function downloadPDF(builder=buildReportHTML,filePrefix="reporte-cartera"){const area=id("print-report");if(!area){showToast("No se encontró el área de reporte.",true);return;}if(!window.html2canvas||!window.jspdf?.jsPDF){showToast("No se cargaron los componentes necesarios para PDF. Verifica tu conexión a internet y recarga la página.",true);return;}area.innerHTML=builder();area.classList.add("pdf-rendering");try{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const images=[...area.querySelectorAll("img")];await Promise.all(images.map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=img.onerror=r;})));const canvas=await html2canvas(area,{scale:2,useCORS:true,allowTaint:false,backgroundColor:"#ffffff",logging:false});const {jsPDF}=window.jspdf;const pdf=new jsPDF({orientation:"landscape",unit:"mm",format:"a4"});const pageW=297,pageH=210,margin=8,imgW=pageW-margin*2,pxPerPage=canvas.width*(pageH-margin*2)/imgW;let sourceY=0;while(sourceY<canvas.height){const h=Math.min(pxPerPage,canvas.height-sourceY);const pageCanvas=document.createElement("canvas");pageCanvas.width=canvas.width;pageCanvas.height=h;pageCanvas.getContext("2d").drawImage(canvas,0,sourceY,canvas.width,h,0,0,canvas.width,h);if(sourceY>0)pdf.addPage();pdf.addImage(pageCanvas.toDataURL("image/jpeg",0.95),"JPEG",margin,margin,imgW,h*imgW/canvas.width);sourceY+=h;}pdf.save(`${filePrefix}-${new Date().toISOString().slice(0,10)}.pdf`);showToast("PDF descargado correctamente.");}catch(e){console.error(e);showToast("No fue posible generar el PDF. Abre la consola del navegador para ver el detalle.",true);}finally{area.classList.remove("pdf-rendering");}}

  function buildAdvisorSummaryReportHTML(){
    const filtered=getFilteredAdminCalls(), groups={};
    filtered.forEach(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Sin asesor";const key=c.asesor_id||name;if(!groups[key])groups[key]={nombre:name,total:0,contestadas:0,nocontestadas:0,whatsapp:0,compromisos:0,pagos:0,zones:new Set()};const g=groups[key];g.total++;if(c.llamada==="Contestada")g.contestadas++;if(c.llamada==="No contestada")g.nocontestadas++;if(c.whatsapp_enviado)g.whatsapp++;if(c.compromiso_pago)g.compromisos++;if(c.pago)g.pagos++;if(c.zona)g.zones.add(c.zona);});
    const rows=Object.values(groups).map(g=>`<tr><td><strong>${escapeHTML(g.nombre)}</strong></td><td>${g.total}</td><td>${g.contestadas}</td><td>${g.nocontestadas}</td><td>${g.whatsapp}</td><td>${g.compromisos}</td><td>${g.pagos}</td><td>${escapeHTML([...g.zones].join(", ")||"—")}</td></tr>`).join("");
    const total=filtered.length;
    const comparativo=Object.values(groups).sort((a,b)=>b.total-a.total).slice(0,8).map(g=>({label:g.nombre,value:g.total,color:"#8064b3"}));
    return `<div class="print-report-sheet compact-pdf">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">RESUMEN DE LLAMADAS</span><h1>Comparativo por asesor</h1><p>Periodo: <strong>${escapeHTML(value("filtroDesdeAdmin")||value("filtroHastaAdmin")?`${value("filtroDesdeAdmin")?formatDate(value("filtroDesdeAdmin")):"Inicio"} – ${value("filtroHastaAdmin")?formatDate(value("filtroHastaAdmin")):"Actual"}`:"Todos los periodos")}</strong> · Asesores: <strong>${escapeHTML(asesoresComparadosTexto())}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total llamadas</span><strong>${total}</strong></div><div class="print-summary-card"><span>Asesores comparados</span><strong>${Object.keys(groups).length}</strong></div><div class="print-summary-card"><span>Contestadas</span><strong>${filtered.filter(c=>c.llamada==="Contestada").length}</strong></div><div class="print-summary-card"><span>No contestadas</span><strong>${filtered.filter(c=>c.llamada==="No contestada").length}</strong></div></div><section class="print-charts" style="grid-template-columns:1fr"><div class="print-chart-card"><h2>Llamadas totales por asesor</h2>${svgBarCompare(comparativo,900)}</div></section><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">DETALLE AGRUPADO</span><h2>Resumen de llamadas por asesor</h2></div><strong>${Object.keys(groups).length} asesor${Object.keys(groups).length===1?"":"es"}</strong></div><div class="print-table-scroll"><table><thead><tr><th>Asesor</th><th>Total</th><th>Contestadas</th><th>No contestadas</th><th>WhatsApp</th><th>Compromisos</th><th>Pagos</th><th>Zonas gestionadas</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="print-empty-row">No hay llamadas para los filtros seleccionados.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function downloadAdvisorSummaryExcel(){
    (async () => {
    try{
      if(!window.XLSX){showToast("No se pudo cargar el módulo de Excel.",true);return;}
      const filtered=getFilteredAdminCalls(),groups={};
      filtered.forEach(c=>{const a=c.perfilescr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Sin asesor";const key=c.asesor_id||name;if(!groups[key])groups[key]={Asesor:name,Total:0,Contestadas:0,"No contestadas":0,WhatsApp:0,Compromisos:0,Pagos:0,Zonas:new Set()};const g=groups[key];g.Total++;if(c.llamada==="Contestada")g.Contestadas++;if(c.llamada==="No contestada")g["No contestadas"]++;if(c.whatsapp_enviado)g.WhatsApp++;if(c.compromiso_pago)g.Compromisos++;if(c.pago)g.Pagos++;if(c.zona)g.Zonas.add(c.zona);});
      const grouped=Object.values(groups).map(g=>({...g,Zonas:[...g.Zonas].join(", ")||"—"}));
      const wb=window.XLSX.utils.book_new();
      const wsResumen=window.XLSX.utils.json_to_sheet(grouped.length?grouped:[{Asesor:"",Total:0,Contestadas:0,"No contestadas":0,WhatsApp:0,Compromisos:0,Pagos:0,Zonas:""}]);
      wsResumen["!cols"]=[{wch:28},{wch:10},{wch:14},{wch:17},{wch:12},{wch:14},{wch:10},{wch:35}];
      window.XLSX.utils.book_append_sheet(wb,wsResumen,"Resumen por asesor");
      const wsGraficos=window.XLSX.utils.aoa_to_sheet([["Gráficos comparativos por asesor"]]); wsGraficos["!cols"]=[{wch:14}];
      window.XLSX.utils.book_append_sheet(wb,wsGraficos,"Gráficos");
      const detail=filtered.map(c=>{const a=c.perfilescr||{};return {"Asesor":[a.nombre,a.apellido].filter(Boolean).join(" ")||"—","Cliente":c.cliente,"Llamada":c.llamada||"—","Tipo de llamada":c.tipo_gestion||"—","Zona":c.zona||"—","WhatsApp":c.whatsapp_enviado?"Sí":"No","Compromiso":c.compromiso_pago?formatDate(c.fecha_compromiso):"—","Pago":c.pago?"Sí":"No","Observaciones":c.observaciones||"","Fecha":c.fecha_llamada};});
      const wsDetalle=window.XLSX.utils.json_to_sheet(detail.length?detail:[{"Asesor":"","Cliente":"","Llamada":"","Tipo de llamada":"","Zona":"","WhatsApp":"","Compromiso":"","Pago":"","Observaciones":"","Fecha":""}]);
      wsDetalle["!cols"]=[{wch:25},{wch:22},{wch:16},{wch:42},{wch:16},{wch:10},{wch:14},{wch:8},{wch:38},{wch:14}];
      window.XLSX.utils.book_append_sheet(wb,wsDetalle,"Detalle");
      const asesorCat=grouped.map(g=>g.Asesor), totalVals=grouped.map(g=>g.Total), contestadasVals=grouped.map(g=>g.Contestadas), pagosVals=grouped.map(g=>g.Pagos);
      const filas=grouped.length, base=2; // fila 1 = encabezado en "Resumen por asesor"
      const charts=grouped.length?[{
        type:"bar", title:"Total de llamadas por asesor", sheetRef:"'Resumen por asesor'",
        catCount:filas, cats:asesorCat, series:[
          {name:"Total", valRange:`$B$${base}:$B$${base+filas-1}`, vals:totalVals, color:"8064b3"},
          {name:"Contestadas", valRange:`$C$${base}:$C$${base+filas-1}`, vals:contestadasVals, color:"2ecc71"}
        ], catRange:`$A$${base}:$A$${base+filas-1}`,
        anchor:{fromCol:0,fromRow:2,toCol:8,toRow:22}
      },{
        type:"bar", title:"Pagos por asesor", sheetRef:"'Resumen por asesor'",
        catCount:filas, cats:asesorCat, series:[
          {name:"Pagos", valRange:`$G$${base}:$G$${base+filas-1}`, vals:pagosVals, color:"f1c40f"}
        ], catRange:`$A$${base}:$A$${base+filas-1}`,
        anchor:{fromCol:9,fromRow:2,toCol:16,toRow:22}
      }]:[];
      await saveWorkbookWithCharts(wb,2,charts,`resumen-llamadas-por-asesor-${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Resumen por asesor descargado en Excel con gráficos.");
    }catch(e){console.error(e);showToast("No fue posible generar el Excel del resumen.",true);}
    })();
  }

  function buildAdvisorReportHTML(){
    const list=getFilteredAsesorCalls(),total=list.length,contestadas=list.filter(c=>c.llamada==="Contestada").length,no=list.filter(c=>c.llamada==="No contestada").length,equivocadas=list.filter(c=>c.llamada==="Equivocada").length,compromisos=list.filter(c=>c.compromiso_pago).length,pagos=list.filter(c=>c.pago).length,pct=n=>total?Math.round(n/total*100):0;
    const nombre=[currentProfile?.nombre,currentProfile?.apellido].filter(Boolean).join(" ")||currentProfile?.email||"Asesor";
    const meta=metaDe(currentProfile),avance=metaPct(calls.length,meta);
    const from=value("filtroAsesorDesde"),to=value("filtroAsesorHasta"),period=from||to?`${from?formatDate(from):"Inicio"} – ${to?formatDate(to):"Actual"}`:"Todos los periodos";
    const rows=list.map(c=>`<tr><td>${escapeHTML(c.cliente)}</td><td>${escapeHTML(c.llamada)}</td><td>${escapeHTML(TIPOS_GESTION_CORTO[c.tipo_gestion]||c.tipo_gestion||"—")}</td><td>${escapeHTML(c.zona)}</td><td>${formatDate(c.fecha_llamada)}</td><td>${c.compromiso_pago?formatDate(c.fecha_compromiso):"—"}</td><td>${c.pago?"Sí":"No"}</td></tr>`).join("");
    return `<div class="print-report-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">REPORTE DE AVANCE</span><h1>${escapeHTML(nombre)}</h1><p>Zona: <strong>${escapeHTML(currentProfile?.zona||"—")}</strong> · Periodo: <strong>${escapeHTML(period)}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Llamadas del periodo</span><strong>${total}</strong></div><div class="print-summary-card"><span>Contestadas</span><strong>${contestadas}</strong></div><div class="print-summary-card"><span>Compromisos</span><strong>${compromisos}</strong></div><div class="print-summary-card"><span>Pagos</span><strong>${pagos}</strong></div><div class="print-summary-card"><span>Meta asignada</span><strong>${meta}</strong></div><div class="print-summary-card"><span>Avance de la meta</span><strong>${avance}%</strong></div><div class="print-summary-card"><span>Pendientes</span><strong>${Math.max(0,meta-calls.length)}</strong></div></div><section class="print-charts">${donutCardHTML("Tipo de llamada",[{label:"Contestada",value:contestadas,color:"#2ecc71"},{label:"No contestada",value:no,color:"#e74c3c"},{label:"Equivocada",value:equivocadas,color:"#f1c40f"}],total,"total")}<div class="print-chart-card" style="grid-column:span 2"><h2>Tipo de llamada</h2>${svgBarCompare(TIPOS_GESTION.map(t=>({label:TIPOS_GESTION_CORTO[t]||t,value:list.filter(c=>c.tipo_gestion===t).length,color:"#0ea5e9"})),620)}</div></section><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">DETALLE</span><h2>Mis llamadas</h2></div><strong>${total} resultado${total===1?"":"s"}</strong></div><div class="print-table-scroll"><table><thead><tr><th>Cliente</th><th>Llamada</th><th>Tipo de llamada</th><th>Zona</th><th>Fecha</th><th>Compromiso</th><th>Pago</th></tr></thead><tbody>${rows||'<tr><td colspan="8" class="print-empty-row">No hay registros.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function previewAdvisorReport(){previewReport(buildAdvisorReportHTML);}
  function printAdvisorReport(){printReport(buildAdvisorReportHTML);}
  function downloadAdvisorPDF(){downloadPDF(buildAdvisorReportHTML,"mi-reporte-cartera");}

  // =================================================================
  // GRÁFICOS NATIVOS DE EXCEL (OOXML) — SheetJS solo escribe datos, así
  // que los gráficos reales se inyectan manipulando el .xlsx (que es un
  // zip) con JSZip: se agregan xl/charts/chartN.xml + xl/drawings/... y
  // se referencian desde la hoja de "Gráficos". Así el gráfico queda
  // embebido y editable en Excel, no como una imagen ni texto ASCII.
  // =================================================================
  function escapeXml(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function chartXmlPie({title,sheetRef,catRange,valRange,catCount,cats,vals,colors}){
    const colorEls=colors.map((c,i)=>`<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></c:spPr></c:dPt>`).join("");
    const catPts=cats.map((v,i)=>`<c:pt idx="${i}"><c:v>${escapeXml(v)}</c:v></c:pt>`).join("");
    const valPts=vals.map((v,i)=>`<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-CO" sz="1200" b="1"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:pieChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>
${colorEls}
<c:cat><c:strRef><c:f>${sheetRef}!${catRange}</c:f><c:strCache><c:ptCount val="${catCount}"/>${catPts}</c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:f>${sheetRef}!${valRange}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${catCount}"/>${valPts}</c:numCache></c:numRef></c:val>
</c:ser><c:firstSliceAng val="0"/></c:pieChart></c:plotArea>
<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
  }
  function chartXmlBar({title,sheetRef,catRange,catCount,cats,series}){
    const axId1=Math.floor(100000000+Math.random()*800000000), axId2=axId1+1;
    const sers=series.map((s,i)=>{
      const catPts=cats.map((v,j)=>`<c:pt idx="${j}"><c:v>${escapeXml(v)}</c:v></c:pt>`).join("");
      const valPts=s.vals.map((v,j)=>`<c:pt idx="${j}"><c:v>${v}</c:v></c:pt>`).join("");
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>
        <c:tx><c:v>${escapeXml(s.name)}</c:v></c:tx>
        <c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr>
        <c:cat><c:strRef><c:f>${sheetRef}!${catRange}</c:f><c:strCache><c:ptCount val="${catCount}"/>${catPts}</c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:f>${sheetRef}!${s.valRange}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${catCount}"/>${valPts}</c:numCache></c:numRef></c:val>
      </c:ser>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="es-CO" sz="1200" b="1"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
${sers}
<c:axId val="${axId1}"/><c:axId val="${axId2}"/>
</c:barChart>
<c:catAx><c:axId val="${axId1}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:txPr><a:bodyPr rot="-2700000" vert="horz"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="es-CO"/></a:p></c:txPr><c:crossAx val="${axId2}"/></c:catAx>
<c:valAx><c:axId val="${axId2}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="${axId1}"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;
  }
  function drawingXmlAnchors(anchors){
    const frames=anchors.map(a=>`
<xdr:twoCellAnchor>
<xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro="">
<xdr:nvGraphicFramePr><xdr:cNvPr id="${a.id}" name="${a.name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${a.chartRid}"/></a:graphicData></a:graphic>
</xdr:graphicFrame>
<xdr:clientData/>
</xdr:twoCellAnchor>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${frames}
</xdr:wsDr>`;
  }
  async function injectChartsIntoWorkbook(buf,sheetIndex,charts){
    const zip=await window.JSZip.loadAsync(buf);
    const sheetPath=`xl/worksheets/sheet${sheetIndex}.xml`;
    let sheetXml=await zip.file(sheetPath).async("string");
    const anchors=[];
    charts.forEach((c,i)=>{
      const n=i+1;
      const xml=c.type==="pie"?chartXmlPie(c):chartXmlBar(c);
      zip.file(`xl/charts/chart${n}.xml`,xml);
      anchors.push({chartRid:`rId${n}`,fromCol:c.anchor.fromCol,fromRow:c.anchor.fromRow,toCol:c.anchor.toCol,toRow:c.anchor.toRow,id:100+n,name:`Chart${n}`});
    });
    zip.file("xl/drawings/drawing1.xml",drawingXmlAnchors(anchors));
    zip.file("xl/drawings/_rels/drawing1.xml.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((c,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i+1}.xml"/>`).join("")}</Relationships>`);
    zip.file(`xl/worksheets/_rels/sheet${sheetIndex}.xml.rels`,`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    if(!sheetXml.includes("<drawing ")) sheetXml=sheetXml.replace("</worksheet>",`<drawing r:id="rIdDrawing1"/></worksheet>`);
    zip.file(sheetPath,sheetXml);
    let ct=await zip.file("[Content_Types].xml").async("string");
    let additions=`<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
    charts.forEach((c,i)=>{additions+=`<Override PartName="/xl/charts/chart${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;});
    ct=ct.replace("</Types>",`${additions}</Types>`);
    zip.file("[Content_Types].xml",ct);
    return zip.generateAsync({type:"uint8array"});
  }
  async function saveWorkbookWithCharts(wb,sheetIndexForCharts,charts,filename){
    const buf=window.XLSX.write(wb,{type:"array",bookType:"xlsx"});
    let finalBuf=buf;
    if(window.JSZip&&charts&&charts.length){
      try{ finalBuf=await injectChartsIntoWorkbook(buf,sheetIndexForCharts,charts); }
      catch(e){ console.error("No se pudieron insertar los gráficos nativos, se descarga el Excel sin gráficos:",e); finalBuf=buf; }
    }
    try{
      const blob=new Blob([finalBuf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url),4000);
    }catch(e){
      console.error("No fue posible iniciar la descarga, se usa el método alternativo:",e);
      window.XLSX.writeFile(wb,filename);
    }
  }

  function downloadExcel(){
    (async () => {
    try{
      if(!window.XLSX){showToast("No se pudo cargar el módulo de Excel.",true);return;}
      const filtered=getFilteredAdminCalls();
      const total=filtered.length,contestadas=filtered.filter(c=>c.llamada==="Contestada").length,no=filtered.filter(c=>c.llamada==="No contestada").length,equivocadas=filtered.filter(c=>c.llamada==="Equivocada").length,compromisos=filtered.filter(c=>c.compromiso_pago).length,pagos=filtered.filter(c=>c.pago).length,pct=n=>total?Math.round(n/total*100):0;
      const metas=metasResumen(filtered),metaTotal=metas.reduce((a,f)=>a+f.meta,0);
      const period=value("filtroDesdeAdmin")||value("filtroHastaAdmin")?`${value("filtroDesdeAdmin")?formatDate(value("filtroDesdeAdmin")):"Inicio"} – ${value("filtroHastaAdmin")?formatDate(value("filtroHastaAdmin")):"Actual"}`:"Todos los periodos";

      const summary=[];
      summary.push(["REPORTE DE CARTERA"]); summary.push(["Periodo",period]); summary.push(["Asesores",asesoresComparadosTexto()]); summary.push([]);
      summary.push(["RESUMEN GENERAL"]); summary.push(["Indicador","Cantidad","Porcentaje"]);
      summary.push(["Total llamadas",total,"100%"]); summary.push(["Contestadas",contestadas,`${pct(contestadas)}%`]); summary.push(["No contestadas",no,`${pct(no)}%`]); summary.push(["Equivocadas",equivocadas,`${pct(equivocadas)}%`]); summary.push(["Compromisos de pago",compromisos,`${pct(compromisos)}%`]); summary.push(["Pagos",pagos,`${pct(pagos)}%`]); summary.push(["Meta total de llamadas",metaTotal,`${metaPct(total,metaTotal)}% cumplido`]); summary.push([]);
      summary.push(["TIPO DE LLAMADA","Cantidad"]);
      const tipoStart=summary.length+1;
      LLAMADA_REPORT_TYPES.forEach(t=>summary.push([t,filtered.filter(c=>(c.llamada||"Sin especificar")===t).length]));
      const tipoEnd=summary.length; summary.push([]);
      summary.push(["TIPO DE LLAMADA","Cantidad"]);
      const gestionStart=summary.length+1;
      TIPOS_GESTION.forEach(t=>summary.push([t,filtered.filter(c=>c.tipo_gestion===t).length]));
      const gestionEnd=summary.length; summary.push([]);
      summary.push(["CUMPLIMIENTO DE METAS POR ASESOR"]); summary.push(["Asesor","Meta","Llamadas realizadas","Pendientes","% de cumplimiento"]);
      const metasStart=summary.length+1;
      metas.forEach(f=>summary.push([f.nombre,f.meta,f.hechas,f.pendientes,`${f.pct}%`]));
      const metasEnd=summary.length;

      const wsResumen=window.XLSX.utils.aoa_to_sheet(summary); wsResumen["!cols"]=[{wch:42},{wch:16},{wch:20},{wch:15},{wch:20}];
      const wb=window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb,wsResumen,"Resumen");
      const wsGraficos=window.XLSX.utils.aoa_to_sheet([["Gráficos del reporte"]]); wsGraficos["!cols"]=[{wch:14}];
      window.XLSX.utils.book_append_sheet(wb,wsGraficos,"Gráficos");
      const detail=filtered.map(c=>{const a=c.perfilescr||{};return {"Asesor":[a.nombre,a.apellido].filter(Boolean).join(" ")||"—","Cliente":c.cliente,"Llamada":c.llamada||"—","Tipo de llamada":c.tipo_gestion||"—","Zona":c.zona||"—","WhatsApp":c.whatsapp_enviado?"Sí":"No","Compromiso":c.compromiso_pago?formatDate(c.fecha_compromiso):"—","Pago":c.pago?"Sí":"No","Observaciones":c.observaciones||"","Fecha":c.fecha_llamada};});
      const wsDetalle=window.XLSX.utils.json_to_sheet(detail.length?detail:[{"Asesor":"","Cliente":"","Llamada":"","Tipo de llamada":"","Zona":"","WhatsApp":"","Compromiso":"","Pago":"","Fecha":""}]);
      wsDetalle["!cols"]=[{wch:25},{wch:22},{wch:16},{wch:42},{wch:16},{wch:10},{wch:14},{wch:8},{wch:14}];
      window.XLSX.utils.book_append_sheet(wb,wsDetalle,"Detalle");

      const charts=[{
        type:"pie", title:"Tipo de llamada", sheetRef:"Resumen",
        catRange:`$A$${tipoStart}:$A$${tipoEnd}`, valRange:`$B$${tipoStart}:$B$${tipoEnd}`, catCount:tipoEnd-tipoStart+1,
        cats:LLAMADA_REPORT_TYPES, vals:LLAMADA_REPORT_TYPES.map(t=>filtered.filter(c=>(c.llamada||"Sin especificar")===t).length), colors:["2ecc71","e74c3c","f1c40f","3498db","9b59b6","95a5a6"],
        anchor:{fromCol:0,fromRow:1,toCol:7,toRow:20}
      },{
        type:"bar", title:"Tipo de llamada", sheetRef:"Resumen",
        catRange:`$A$${gestionStart}:$A$${gestionEnd}`, catCount:gestionEnd-gestionStart+1, cats:TIPOS_GESTION.map(t=>TIPOS_GESTION_CORTO[t]||t),
        series:[{name:"Cantidad", valRange:`$B$${gestionStart}:$B$${gestionEnd}`, vals:TIPOS_GESTION.map(t=>filtered.filter(c=>c.tipo_gestion===t).length), color:"0ea5e9"}],
        anchor:{fromCol:8,fromRow:1,toCol:19,toRow:20}
      }];
      if(metas.length){
        charts.push({
          type:"bar", title:"Cumplimiento de metas por asesor", sheetRef:"Resumen",
          catRange:`$A$${metasStart}:$A$${metasEnd}`, catCount:metasEnd-metasStart+1, cats:metas.map(f=>f.nombre),
          series:[
            {name:"Meta", valRange:`$B$${metasStart}:$B$${metasEnd}`, vals:metas.map(f=>f.meta), color:"d7cdef"},
            {name:"Realizadas", valRange:`$C$${metasStart}:$C$${metasEnd}`, vals:metas.map(f=>f.hechas), color:"8064b3"}
          ],
          anchor:{fromCol:0,fromRow:22,toCol:9,toRow:41}
        });
      }
      await saveWorkbookWithCharts(wb,2,charts,`reporte-cartera-${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Excel descargado con gráficos nativos y detalle de llamadas.");
    }catch(e){console.error(e);showToast("No fue posible generar el Excel.",true);}
    })();
  }

  function populateSurveyFilters(){ populateSurveyAdvisorSelects(); }
  function getFilteredSurveys(){
    const asesorIds=surveyAdvisorIds("satisfaccion"),from=value("filtroEncuestaDesde"),to=value("filtroEncuestaHasta"),text=value("filtroEncuestaTexto").toLowerCase();
    return (reportSurveys||surveys).filter(s=>{
      const a=s.perfilescr||{}, l=s.llamadascr||{};
      const search=[a.nombre,a.apellido,a.email,s.codigo_usuario,s.calificacion_servicio,s.calificacion_tecnica,s.calificacion_administrativa,s.agilidad_averias,s.recomendaria,s.recomendacion_felicitacion,s.observacion_servicio,s.observacion_tecnica,s.observacion_administrativa,s.zona,l.cliente,l.zona,l.llamada,l.tipo_gestion,l.observaciones].join(" ").toLowerCase();
      const fechaEncuesta=s.fecha_encuesta||s.created_at?.slice(0,10)||"";
      return (asesorIds.length>0&&asesorIds.includes(s.asesor_id))&&(!from||fechaEncuesta>=from)&&(!to||fechaEncuesta<=to)&&(!text||search.includes(text));
    });
  }
  function renderSurveys(){
    const tbody=id("tabla-encuestas"); if(!tbody)return;
    const filtered=getFilteredSurveys();
    setText("survey-result-count",`${filtered.length} encuesta${filtered.length===1?"":"s"}`);
    tbody.innerHTML=filtered.length?filtered.map(s=>{
      const a=s.perfilescr||{},l=s.llamadascr||{},name=[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—";
      return `<tr><td>${formatDate(s.fecha_encuesta||s.created_at?.slice(0,10))}</td><td>${formatDate(l.fecha_llamada)}</td><td><strong>${escapeHTML(name)}</strong></td><td>${escapeHTML(s.codigo_usuario||l.cliente||"—")}</td><td>${escapeHTML(s.zona||l.zona||"—")}</td><td>${escapeHTML(l.llamada||"—")}</td><td>${escapeHTML(l.tipo_gestion||"—")}</td><td>${escapeHTML(l.observaciones||"—")}</td><td>${escapeHTML(s.codigo_usuario||"—")}</td><td>${escapeHTML(s.calificacion_servicio)}</td><td>${escapeHTML(s.calificacion_tecnica)}</td><td>${escapeHTML(s.calificacion_administrativa)}</td><td>${escapeHTML(s.agilidad_averias)}</td><td>${escapeHTML(s.recomendaria)}</td><td>${escapeHTML(s.recomendacion_felicitacion||"—")}</td><td>${escapeHTML(s.observacion_servicio||"—")}</td><td>${escapeHTML(s.observacion_tecnica||"—")}</td><td>${escapeHTML(s.observacion_administrativa||"—")}</td></tr>`;
    }).join(""):`<tr class="empty-row"><td colspan="18">${surveys.length?"No se encontraron encuestas con los filtros seleccionados.":"No hay encuestas registradas."}</td></tr>`;
  }
  async function clearSurveyFilters(){
    ["filtroEncuestaDesde","filtroEncuestaHasta","filtroEncuestaTexto"].forEach(x=>{if(id(x))id(x).value="";});
    id("ms-encuesta-asesores-list")?.querySelectorAll("input").forEach(x=>x.checked=true);
    if(id("ms-encuesta-asesores-toggle")) id("ms-encuesta-asesores-toggle").textContent="Todos los asesores";
    reportSurveys=null; renderSurveys();
  }
  function surveyPeriod(){
    const from=value("filtroEncuestaDesde"),to=value("filtroEncuestaHasta");
    return from||to?`${from?formatDate(from):"Inicio"} – ${to?formatDate(to):"Actual"}`:"Todos los periodos";
  }
  function surveyAdvisorFilterName(){
    const ids=surveyAdvisorIds("satisfaccion");
    if(!ids.length || ids.length===advisors.length)return "Todos los asesores";
    const names=ids.map(uid=>advisors.find(x=>x.id===uid)).filter(Boolean).map(a=>[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"Asesor");
    return names.join(", ");
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
      return `<tr><td>${formatDate(s.fecha_encuesta||s.created_at?.slice(0,10))}</td><td>${formatDate(l.fecha_llamada)}</td><td>${escapeHTML(name)}</td><td>${escapeHTML(s.codigo_usuario||l.cliente||"—")}</td><td>${escapeHTML(s.zona||l.zona||"—")}</td><td>${escapeHTML(l.llamada||"—")}</td><td>${escapeHTML(l.tipo_gestion||"—")}</td><td>${escapeHTML(l.observaciones||"—")}</td>${questions.map(([,get])=>`<td>${escapeHTML(get(s)||"—")}</td>`).join("")}<td>${escapeHTML(s.observacion_servicio||"—")}</td><td>${escapeHTML(s.observacion_tecnica||"—")}</td><td>${escapeHTML(s.observacion_administrativa||"—")}</td></tr>`;
    }).join("");
    return `<div class="print-report-sheet survey-print-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">REPORTE DE SATISFACCIÓN</span><h1>Encuestas por asesor</h1><p>Asesor: <strong>${escapeHTML(surveyAdvisorFilterName())}</strong> · Periodo: <strong>${escapeHTML(surveyPeriod())}</strong></p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total encuestas</span><strong>${filtered.length}</strong></div><div class="print-summary-card"><span>Recomendarían</span><strong>${filtered.filter(s=>s.recomendaria==="SI").length}</strong></div><div class="print-summary-card"><span>No recomendarían</span><strong>${filtered.filter(s=>s.recomendaria==="NO").length}</strong></div></div><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">7 RESPUESTAS</span><h2>Detalle de encuestas</h2></div><strong>${filtered.length} encuesta${filtered.length===1?"":"s"}</strong></div><div class="print-table-scroll"><table class="survey-report-table"><thead><tr><th>Fecha encuesta</th><th>Fecha llamada</th><th>Asesor</th><th>Cliente</th><th>Zona</th><th>Llamada</th><th>Tipo de gestión</th><th>Obs. llamada</th><th>01. Usuario</th><th>02. Servicio</th><th>03. Técnica</th><th>04. Administrativa</th><th>05. Averías</th><th>06. Recomendaría</th><th>07. Recomendación</th><th>Obs. servicio</th><th>Obs. técnica</th><th>Obs. administrativa</th></tr></thead><tbody>${rows||'<tr><td colspan="18" class="print-empty-row">No hay encuestas para los filtros seleccionados.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function downloadSurveyExcel(){
    try{
      if(!window.XLSX){showToast("No se pudo cargar el módulo de Excel.",true);return;}
      const filtered=getFilteredSurveys();
      const detail=filtered.map(s=>{
        const a=s.perfilescr||{},l=s.llamadascr||{};
        return {
          "Fecha encuesta":s.fecha_encuesta||s.created_at?.slice(0,10)||"","Fecha llamada":l.fecha_llamada||"","Asesor":[a.nombre,a.apellido].filter(Boolean).join(" ")||a.email||"—",
          "Cliente":s.codigo_usuario||l.cliente||"","Zona":s.zona||l.zona||"","Tipo de llamada":l.llamada||"","Tipo de gestión":l.tipo_gestion||"","Observación llamada":l.observaciones||"",
          "01. Usuario encuestado":s.codigo_usuario||"","02. Servicio":s.calificacion_servicio||"",
          "03. Técnica":s.calificacion_tecnica||"","04. Administrativa":s.calificacion_administrativa||"",
          "05. Averías":s.agilidad_averias||"","06. Recomendaría":s.recomendaria||"",
          "07. Recomendación / felicitación":s.recomendacion_felicitacion||"",
          "Observación servicio":s.observacion_servicio||"","Observación técnica":s.observacion_tecnica||"",
          "Observación administrativa":s.observacion_administrativa||""
        };
      });
      const ws=window.XLSX.utils.json_to_sheet(detail.length?detail:[{"Fecha":"","Asesor":""}]);
      ws["!cols"]=[{wch:14},{wch:14},{wch:24},{wch:26},{wch:16},{wch:18},{wch:28},{wch:36},{wch:18},{wch:18},{wch:20},{wch:22},{wch:16},{wch:40},{wch:35},{wch:35},{wch:35}];
      const wb=window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb,ws,"Encuestas");
      const summary=window.XLSX.utils.aoa_to_sheet([["REPORTE DE ENCUESTAS"],["Asesor",surveyAdvisorFilterName()],["Periodo",surveyPeriod()],["Total encuestas",filtered.length],["Recomendarían",filtered.filter(s=>s.recomendaria==="SI").length],["No recomendarían",filtered.filter(s=>s.recomendaria==="NO").length]]);
      window.XLSX.utils.book_append_sheet(wb,summary,"Resumen");
      window.XLSX.writeFile(wb,`reporte-encuestas-cartera-${new Date().toISOString().slice(0,10)}.xlsx`);
      showToast("Reporte de encuestas descargado.");
    }catch(e){console.error(e);showToast("No fue posible generar el Excel de encuestas.",true);}
  }

  const ALL_VIEWS=["auth-view","register-view","vista-asesor","admin-dashboard","vista-admin","vista-encuestas-hub","vista-encuestas","vista-encuesta-seguimiento","vista-encuesta-servicio","vista-usuarios","vista-configuracion","vista-respaldo"];
  function showAuthView(){ALL_VIEWS.forEach(x=>id(x).classList.add("hidden"));id("auth-view").classList.remove("hidden");id("session-area").classList.add("hidden");id("btn-menu").classList.add("hidden");id("sidebar").classList.add("hidden");}
  function showView(viewId){ALL_VIEWS.forEach(x=>id(x).classList.add("hidden"));id(viewId).classList.remove("hidden");if(viewId!=="auth-view"&&currentProfile){id("session-area").classList.remove("hidden");id("btn-menu").classList.remove("hidden");id("sidebar").classList.remove("hidden");}}
  function setSectionMode(viewId,mode){const view=id(viewId);if(!view)return;const panels=view.querySelectorAll(":scope > .survey-panel");if(!panels.length)return;panels.forEach(p=>p.classList.toggle("hidden",p.dataset.panel!==mode));}
  async function logout(){const {error}=await sbClient.auth.signOut();if(error)showToast("No fue posible cerrar la sesión.",true);}
  function llamadaBadge(t){if(!t)return '<span class="badge badge-disabled">Sin especificar</span>';if(t==="Contestada")return '<span class="badge badge-complete">Contestada</span>';if(t==="Equivocada")return '<span class="badge badge-cancelled">Equivocada</span>';if(t==="Llamadas recibidas")return '<span class="badge badge-active">Llamadas recibidas</span>';if(t==="WhatsApp recibido")return '<span class="badge badge-pending">WhatsApp recibido</span>';return '<span class="badge badge-pending">No contestada</span>';}
  const TIPOS_GESTION_CORTO={"Llamadas recibidas":"Llamadas recibidas","WhatsApp recibido":"WhatsApp recibido","Gestión reporte a Data Crédito y abogados":"Reporte DataCrédito/abogados","Gestión lista de suspensión":"Lista de suspensión","Gestión recuperación de equipo":"Recuperación de equipo","Gestión ofreciendo servicio de la empresa":"Ofrecimiento de servicio","Gestión actualización de información":"Actualización de información","Gestión factura del mes":"Tipo de factura del mes"};
  function tipoGestionBadge(t){if(!t)return '<span class="badge badge-disabled">—</span>';return `<span class="badge badge-pending" title="${escapeHTML(t)}">${escapeHTML(TIPOS_GESTION_CORTO[t]||t)}</span>`;}
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


  function surveyDate(x){return x.fecha_encuesta||colombiaDateFromTimestamp(x.created_at);}
  function getFilteredSeguimiento(){const f=value("seg-filter-from"),t=value("seg-filter-to"),uids=surveyAdvisorIds("seguimiento"),u=value("seg-filter-user").toLowerCase(),a=value("seg-filter-att"),p=value("seg-filter-pay");return seguimientoSurveys.filter(x=>{const d=surveyDate(x);return(uids.length>0&&uids.includes(x.asesor_id))&&(!f||d>=f)&&(!t||d<=t)&&(!u||String(x.usuario||"").toLowerCase().includes(u))&&(!a||x.atencion_asesor===a)&&(!p||x.fechas_pago===p);});}
  function getFilteredServicio(){const f=value("srv-filter-from"),t=value("srv-filter-to"),uids=surveyAdvisorIds("servicio"),u=value("srv-filter-user").toLowerCase(),s=value("srv-filter-service"),r=value("srv-filter-retomar");return servicioSurveys.filter(x=>{const d=surveyDate(x);return(uids.length>0&&uids.includes(x.asesor_id))&&(!f||d>=f)&&(!t||d<=t)&&(!u||String(x.usuario||"").toLowerCase().includes(u))&&(!s||x.servicio_retirado===s)&&(!r||x.interes_retomar===r);});}
  const _renderSeg=renderSeguimientoSurveys, _renderSrv=renderServicioSurveys;
  renderSeguimientoSurveys=function(){const rows=getFilteredSeguimiento();const t=id("tabla-seguimiento-encuesta");if(!t)return;t.innerHTML=rows.map(x=>`<tr><td>${escapeHTML(x.perfilescr?[x.perfilescr.nombre,x.perfilescr.apellido].filter(Boolean).join(" ")||x.perfilescr.email||"—":advisorNameById(x.asesor_id))}</td><td>${escapeHTML(x.usuario)}</td><td>${escapeHTML(x.zona||"—")}</td><td>${escapeHTML(x.como_se_entero||"—")}</td><td>${escapeHTML(x.fechas_pago)}</td><td>${escapeHTML(x.medio_contrato)}</td><td>${escapeHTML(x.atencion_asesor)}</td><td>${escapeHTML(x.redes_sociales)}</td><td>${escapeHTML(x.cobro_tecnico)}</td><td>${escapeHTML(x.medios_pago)}</td><td>${formatDate(surveyDate(x))}</td></tr>`).join("")||'<tr class="empty-row"><td colspan="11">No hay encuestas con los filtros seleccionados.</td></tr>';}
  renderServicioSurveys=function(){const rows=getFilteredServicio();const t=id("tabla-servicio-encuesta");if(!t)return;t.innerHTML=rows.map(x=>`<tr><td>${escapeHTML(x.perfilescr?[x.perfilescr.nombre,x.perfilescr.apellido].filter(Boolean).join(" ")||x.perfilescr.email||"—":advisorNameById(x.asesor_id))}</td><td>${escapeHTML(x.usuario)}</td><td>${escapeHTML(x.zona||"—")}</td><td>${escapeHTML(x.servicio_retirado)}</td><td>${escapeHTML(x.motivo_retiro||"—")}</td><td>${escapeHTML(x.interes_retomar)}</td><td>${escapeHTML(x.observaciones||"—")}</td><td>${formatDate(surveyDate(x))}</td></tr>`).join("")||'<tr class="empty-row"><td colspan="8">No hay encuestas con los filtros seleccionados.</td></tr>';}
  function clearSegFilters(){["seg-filter-from","seg-filter-to","seg-filter-user","seg-filter-att","seg-filter-pay"].forEach(k=>{if(id(k))id(k).value="";}); id("ms-seg-asesores-list")?.querySelectorAll("input").forEach(x=>x.checked=true); id("ms-seg-asesores-toggle")&&(id("ms-seg-asesores-toggle").textContent="Todos los asesores");renderSeguimientoSurveys();}
  function clearSrvFilters(){["srv-filter-from","srv-filter-to","srv-filter-user","srv-filter-service","srv-filter-retomar"].forEach(k=>{if(id(k))id(k).value="";}); id("ms-srv-asesores-list")?.querySelectorAll("input").forEach(x=>x.checked=true); id("ms-srv-asesores-toggle")&&(id("ms-srv-asesores-toggle").textContent="Todos los asesores");renderServicioSurveys();}

  function buildSeguimientoReportHTML(){
    const rows=getFilteredSeguimiento();
    const trs=rows.map(x=>`<tr><td>${escapeHTML(x.perfilescr?[x.perfilescr.nombre,x.perfilescr.apellido].filter(Boolean).join(" ")||x.perfilescr.email||"—":advisorNameById(x.asesor_id))}</td><td>${escapeHTML(x.usuario)}</td><td>${escapeHTML(x.zona||"—")}</td><td>${escapeHTML(x.como_se_entero||"—")}</td><td>${escapeHTML(x.fechas_pago)}</td><td>${escapeHTML(x.medio_contrato)}</td><td>${escapeHTML(x.atencion_asesor)}</td><td>${escapeHTML(x.redes_sociales)}</td><td>${escapeHTML(x.cobro_tecnico)}</td><td>${escapeHTML(x.medios_pago)}</td><td>${formatDate(surveyDate(x))}</td></tr>`).join("");
    return `<div class="print-report-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">ENCUESTA DE SEGUIMIENTO</span><h1>Reporte de seguimiento</h1><p>${rows.length} registro${rows.length===1?"":"s"}</p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total encuestas</span><strong>${rows.length}</strong></div><div class="print-summary-card"><span>Fechas de pago informadas</span><strong>${rows.filter(x=>x.fechas_pago==="SI").length}</strong></div><div class="print-summary-card"><span>Cobro técnico adicional</span><strong>${rows.filter(x=>x.cobro_tecnico==="SI").length}</strong></div></div><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">DETALLE</span><h2>Encuestas de seguimiento</h2></div></div><div class="print-table-scroll"><table><thead><tr><th>Asesor</th><th>Usuario</th><th>Zona</th><th>¿Cómo se enteró?</th><th>Fechas de pago</th><th>Contrato</th><th>Atención</th><th>Redes</th><th>Cobro técnico</th><th>Medios de pago</th><th>Fecha</th></tr></thead><tbody>${trs||'<tr><td colspan="11" class="print-empty-row">No hay registros.</td></tr>'}</tbody></table></div></section></div>`;
  }
  function buildServicioReportHTML(){
    const rows=getFilteredServicio();
    const trs=rows.map(x=>`<tr><td>${escapeHTML(x.perfilescr?[x.perfilescr.nombre,x.perfilescr.apellido].filter(Boolean).join(" ")||x.perfilescr.email||"—":advisorNameById(x.asesor_id))}</td><td>${escapeHTML(x.usuario)}</td><td>${escapeHTML(x.zona||"—")}</td><td>${escapeHTML(x.servicio_retirado)}</td><td>${escapeHTML(x.motivo_retiro||"—")}</td><td>${escapeHTML(x.interes_retomar)}</td><td>${escapeHTML(x.observaciones||"—")}</td><td>${formatDate(surveyDate(x))}</td></tr>`).join("");
    return `<div class="print-report-sheet">${config.logo_url?`<div class="print-logo"><img src="${config.logo_url}" alt="Logo"></div>`:""}<div class="print-header"><div><span class="print-kicker">ENCUESTA DE SERVICIO</span><h1>Reporte de retiros de servicio</h1><p>${rows.length} registro${rows.length===1?"":"s"}</p></div><div class="print-generated">Generado: ${new Date().toLocaleString("es-CO")}</div></div><div class="print-summary"><div class="print-summary-card"><span>Total retiros</span><strong>${rows.length}</strong></div><div class="print-summary-card"><span>Interesados en retomar</span><strong>${rows.filter(x=>x.interes_retomar==="SI").length}</strong></div><div class="print-summary-card"><span>No interesados</span><strong>${rows.filter(x=>x.interes_retomar==="NO").length}</strong></div></div><section class="print-table-section"><div class="print-table-title"><div><span class="print-kicker">DETALLE</span><h2>Encuestas de servicio</h2></div></div><div class="print-table-scroll"><table><thead><tr><th>Asesor</th><th>Usuario</th><th>Zona</th><th>Servicio</th><th>Motivo retiro</th><th>Retomaría</th><th>Observaciones</th><th>Fecha</th></tr></thead><tbody>${trs||'<tr><td colspan="7" class="print-empty-row">No hay registros.</td></tr>'}</tbody></table></div></section></div>`;
  }

  document.addEventListener("DOMContentLoaded",()=>{populateSurveyAdvisorSelects();["seg-filter-from","seg-filter-to"].forEach(k=>id(k)?.addEventListener("change",async()=>{await loadHistoricalSeguimiento();renderSeguimientoSurveys();}));["seg-filter-user","seg-filter-att","seg-filter-pay"].forEach(k=>id(k)?.addEventListener("input",renderSeguimientoSurveys));id("seg-filter-clear")?.addEventListener("click",async()=>{clearSegFilters();await loadHistoricalSeguimiento();renderSeguimientoSurveys();});["srv-filter-from","srv-filter-to"].forEach(k=>id(k)?.addEventListener("change",async()=>{await loadHistoricalServicio();renderServicioSurveys();}));["srv-filter-user","srv-filter-service","srv-filter-retomar"].forEach(k=>id(k)?.addEventListener("input",renderServicioSurveys));id("srv-filter-clear")?.addEventListener("click",async()=>{clearSrvFilters();await loadHistoricalServicio();renderServicioSurveys();});
    id("btn-seg-excel")?.addEventListener("click",async()=>{await loadHistoricalSeguimiento();downloadSimpleCSV("seguimiento",getFilteredSeguimiento());});
    id("btn-srv-excel")?.addEventListener("click",async()=>{await loadHistoricalServicio();downloadSimpleCSV("servicio",getFilteredServicio());});
    id("btn-seg-preview")?.addEventListener("click",async()=>{await loadHistoricalSeguimiento();renderSeguimientoSurveys();previewReport(buildSeguimientoReportHTML);});
    id("btn-seg-pdf")?.addEventListener("click",async()=>{await loadHistoricalSeguimiento();downloadPDF(buildSeguimientoReportHTML,"reporte-seguimiento-cartera");});
    id("btn-srv-preview")?.addEventListener("click",async()=>{await loadHistoricalServicio();renderServicioSurveys();previewReport(buildServicioReportHTML);});
    id("btn-srv-pdf")?.addEventListener("click",async()=>{await loadHistoricalServicio();downloadPDF(buildServicioReportHTML,"reporte-servicio-cartera");});
  });

  window.setPago=setPago;window.deleteCall=deleteCall;window.editAdvisor=editAdvisor;window.toggleAdvisor=toggleAdvisor;window.deleteAdvisor=deleteAdvisor;
})();
