import { SREData, AppMetric, InfraMetric, HealthViolation } from "../types";

export function processSRELogic(data: SREData) {
  const processed = {
    violations: data.violations.filter(v => v.status !== "NORMAL"),
    metrics: data.metrics.map(m => {
      let tag = "";
      let status = m.health;
      if (m.errorRate > 5 && m.health === "GREEN") {
        tag = "[MASCARADO]";
        status = "RED" as any; // Force visual critical
      }
      return { ...m, tag, displayStatus: status };
    }),
    infra: data.infra.map(i => {
      let status = "OK";
      let severityClass = "ok";
      
      if (i.ram > 90 && (i.durationAbove90 || 0) > 24) {
        status = "[RISCO DE INDISPONIBILIDADE]";
        severityClass = "critical";
      } else if (i.swap > 50) {
        status = "[CRÍTICO]";
        severityClass = "critical";
      } else if (i.cpu > 80 || i.ram > 80) {
        status = "WARNING";
        severityClass = "warning";
      }

      return { ...i, status, severityClass };
    }),
    dbWaits: data.dbWaits,
    database: data.database,
    repeated: data.violations.filter(v => 
      v.isContinuous || (data.previousDayViolations?.includes(v.id))
    )
  };

  return processed;
}

export function generateMarkdown(data: any, client: string) {
  const date = new Date().toLocaleDateString('pt-BR');
  const score = calculateScore(data);
  const honestPhrase = getHonestPhrase(score);

  let md = `# ${client.toUpperCase()} — Dashboard de Operações — ${date}\n\n`;
  md += `**Status Geral:** ${honestPhrase} [Nota: ${score}/10]\n\n`;
  md += `---\n🚩 ALERTAS REPETIDOS (DO DIA ANTERIOR)\n`;
  
  if (data.repeated.length === 0) {
    md += `- Nenhum alerta repetido detectado.\n`;
  } else {
    data.repeated.forEach((v: any) => {
      const risk = getBusinessRisk(v.entityName, client);
      md += `- ${v.name} — Ativo desde ${new Date(v.startTime).toLocaleString()} — ${risk}\n`;
    });
  }

  md += `\n---\n### APLICAÇÕES\n`;
  md += `| App | Error% | Calls/min | Latência | Status | Tag |\n`;
  md += `|-----|--------|-----------|----------|--------|-----|\n`;
  const filteredMetrics = data.metrics.filter((m: any) => 
    m.displayStatus === 'RED' || m.displayStatus === 'YELLOW' || m.tag === '[MASCARADO]'
  );
  if (filteredMetrics.length === 0) {
    md += `| - | - | - | - | VERDE | - |\n`;
  } else {
    filteredMetrics.forEach((m: any) => {
      md += `| ${m.app} | ${m.errorRate}% | ${m.callsPerMin} | ${m.latency}ms | ${m.displayStatus} | ${m.tag || "-"} |\n`;
    });
  }

  md += `\n### INFRAESTRUTURA\n`;
  md += `| Host | Host ID | CPU | RAM | Swap | Status |\n`;
  md += `|------|---------|-----|-----|------|--------|\n`;
  const filteredInfra = data.infra.filter((i: any) => i.severityClass === 'critical' || i.severityClass === 'warning');
  if (filteredInfra.length === 0) {
    md += `| - | - | - | - | - | OK |\n`;
  } else {
    filteredInfra.forEach((i: any) => {
      md += `| ${i.host} | ${i.hostId || "-"} | ${i.cpu}% | ${i.ram}% | ${i.swap}% | ${i.status} |\n`;
    });
  }

  if (data.database) {
    md += `\n### BANCO DE DADOS — ${data.database.name}\n`;
    md += `**Engine:** ${data.database.engine} | **RAM:** ${data.database.ramUsage}% | **CPU:** ${data.database.cpuUsage}% | **Uptime:** ${data.database.uptime}\n\n`;
    if (data.database.violation) {
      md += `> ⚠️ **Violação:** ${data.database.violation.description} (${data.database.violation.duration})\n\n`;
    }
    md += `| Wait State | Porcentagem |\n`;
    md += `|------------|-------------|\n`;
    data.database.waits.forEach((w: any) => {
      md += `| ${w.name} | ${w.percentage}% |\n`;
    });
  }

  md += `\n---\n### PRÓXIMOS PASSOS\n`;
  const steps = getNextSteps(data);
  steps.forEach((step, i) => {
    md += `${i + 1}. ${step}\n`;
  });

  return md;
}

export function generateHTML(data: any, client: string) {
  const date = new Date().toLocaleDateString('pt-BR');
  const score = calculateScore(data);
  const honestPhrase = getHonestPhrase(score);
  
  // Summary counts
  const appCritCount = data.metrics.filter((m: any) => m.displayStatus === 'RED').length;
  const appWarnCount = data.metrics.filter((m: any) => m.displayStatus === 'YELLOW').length;
  const appMaskedCount = data.metrics.filter((m: any) => m.tag === '[MASCARADO]').length;
  const sqlMemory = data.database ? `${data.database.ramUsage}%` : 'N/A';

  // Masked risk alert box
  const maskedApps = data.metrics.filter((m: any) => m.tag === '[MASCARADO]');
  const maskedAlertHtml = maskedApps.length > 0 ? `
    <div class="callout-crit">
      <strong>⚠️ Atenção – Risco de Negócio Mascarado:</strong> As apps ${maskedApps.map((m: any) => `<strong>${m.app}</strong> (${m.errorRate}% erro${m.latency > 1000 ? ` / ${(m.latency/1000).toFixed(3)}s` : ''})`).join(', ')} estão com <strong>Health verde</strong>, mas apresentam métricas críticas. As Health Rules precisam ser revistas com urgência para não mascarar incidentes de negócio.
    </div>
  ` : '';

  const filteredMetrics = data.metrics.filter((m: any) => 
    m.displayStatus === 'RED' || m.displayStatus === 'YELLOW' || m.tag === '[MASCARADO]'
  );

  const metricsHtml = filteredMetrics.map((m: any) => {
    const severityClass = m.displayStatus === 'RED' ? 'critico' : m.displayStatus === 'YELLOW' ? 'warning' : m.tag === '[MASCARADO]' ? 'masked' : 'critico';
    const statusLabel = m.displayStatus === 'RED' ? 'CRÍTICO' : m.displayStatus === 'YELLOW' ? 'WARNING' : m.tag === '[MASCARADO]' ? 'VERDE (?)' : 'VERDE';
    
    return `
    <div class="app-card ${severityClass}">
      <div class="ac-top">
        <div>
          <div class="ac-name">${m.app}</div>
          <div class="ac-forn">${m.subTitle || 'OWSE'}</div>
        </div>
        <div class="ac-st">${statusLabel}</div>
      </div>
      
      <div class="ac-mt">
        <div>📞 ${m.totalCalls || '0,00M'}</div>
        <div>🔁 ${m.callsPerMin} c/min</div>
        <div>⏱️ ${m.latency} ms</div>
        <div>❌ <b>${m.errorRate}% erros</b></div>
      </div>

      ${m.warningType === 'HEALTH_RULE_INCORRECT' ? `
        <div class="mask-tag">⚠️ HEALTH RULE INCORRETA</div>
      ` : ''}

      <div class="ac-imp">${m.description || ''}</div>
    </div>
  `}).join('');

  const mainInfra = data.infra.find((i: any) => i.severityClass === 'critical' || i.severityClass === 'warning') || data.infra[0];
  const otherInfra = data.infra.filter((i: any) => i !== mainInfra && (i.severityClass === 'critical' || i.severityClass === 'warning'));

  const infraHtml = `
    <div class="infra-grid">
      <div class="infra-card ${mainInfra.severityClass === 'critical' ? 'down' : ''}">
        <div class="infra-head">
          <div class="infra-host">${mainInfra.host}</div>
          <div class="i-badge ${mainInfra.severityClass === 'critical' ? 'critico' : 'warning'}">${mainInfra.status}</div>
        </div>
        
        <div class="bar-row">
          <div class="bar-info"><span>CPU</span><span class="bv">${mainInfra.cpu}%</span></div>
          <div class="bar-track"><div class="bar-fill ${mainInfra.cpu > 80 ? 'bf-crit' : 'bf-ok'}" style="width:${mainInfra.cpu}%;"></div></div>
        </div>
        
        <div class="bar-row">
          <div class="bar-info"><span>Memória</span><span class="bv">${mainInfra.ram}%</span></div>
          <div class="bar-track"><div class="bar-fill ${mainInfra.ram > 80 ? 'bf-crit' : 'bf-ok'}" style="width:${mainInfra.ram}%;"></div></div>
        </div>
        
        <div class="bar-row">
          <div class="bar-info"><span>Disco</span><span class="bv">${mainInfra.disk || 0}%</span></div>
          <div class="bar-track"><div class="bar-fill bf-ok" style="width:${mainInfra.disk || 0}%; background:#979797"></div></div>
        </div>
        
        <div class="bar-row">
          <div class="bar-info"><span>Swap ⚠️</span><span class="bv">${mainInfra.swap}%</span></div>
          <div class="bar-track"><div class="bar-fill ${mainInfra.swap > 50 ? 'bf-crit' : 'bf-warn'}" style="width:${mainInfra.swap}%;"></div></div>
        </div>
        
        <div class="infra-note">
          <b>Host ID: ${mainInfra.hostId || 'N/A'}</b><br>
          ${mainInfra.description || ''}
        </div>
      </div>

      ${otherInfra.length > 0 ? otherInfra.map((i: any) => `
        <div class="infra-card ${i.severityClass === 'critical' ? 'down' : ''}">
          <div class="infra-head">
            <div class="infra-host">${i.host}</div>
            <div class="i-badge ${i.severityClass === 'critical' ? 'critico' : 'warning'}">${i.status}</div>
          </div>
          <div class="bar-row">
            <div class="bar-info"><span>CPU / RAM</span><span class="bv">${i.cpu}% / ${i.ram}%</span></div>
            <div class="bar-track"><div class="bar-fill ${i.cpu > 80 || i.ram > 80 ? 'bf-crit' : 'bf-ok'}" style="width:${Math.max(i.cpu, i.ram)}%;"></div></div>
          </div>
          <div class="infra-note"><b>Host ID: ${i.hostId || 'N/A'}</b></div>
        </div>
      `).join('') : `
        <div class="infra-card">
          <div class="infra-head"><div class="infra-host">Demais Hosts</div><div class="i-badge ok">OK</div></div>
          <div class="infra-note">Nenhum outro host com violação ativa ou swap > 50% na janela de hoje.</div>
        </div>
      `}
    </div>
  `;

  let dbHtml = '';
  if (data.database) {
    const db = data.database;
    const waitsHtml = db.waits.map((w: any) => `
      <div>
        <div class="wait-meta">
          <span class="wn">${w.name}</span>
          <span class="wp" style="color:${w.color};">${w.percentage}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="background:${w.color}; width:${w.percentage}%;"></div></div>
      </div>
    `).join('');

    dbHtml = `
      <div class="db-wrapper">
        <div class="db-card">
          <div class="db-head">
            <div class="db-title">${db.engine} · Top Query Wait States</div>
            <div class="db-pills">
              <div class="db-pill c">RAM ${db.ramUsage}%</div>
              <div class="db-pill w">CPU ${db.cpuUsage}%</div>
              <div class="db-pill b">${db.uptime}</div>
            </div>
          </div>
          
          ${db.violation ? `
            <div class="db-alert">
              <b>Violação Aberta · ${db.violation.description}</b><br>
              Início: ${db.violation.startTime} · Condição: ${db.violation.condition} · Duração: <b>${db.violation.duration}</b>
            </div>
          ` : ''}
          
          <div class="wait-chart">
            ${waitsHtml}
          </div>
        </div>

        <div class="db-card db-exec">
          <div class="exec-ttl">Diagnóstico Técnico</div>
          <ul>
            ${getNextSteps(data).map(step => `<li>${step}</li>`).join('')}
          </ul>
        </div>
      </div>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Dashboard SRE - ${client} - ${date}</title>
<style>
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: Arial, sans-serif; background:#f0f2f5; color:#333; padding:24px; }
  .page { max-width:1200px; margin:0 auto; background:#fff; border-radius:10px; box-shadow:0 2px 16px rgba(0,0,0,.12); overflow:hidden; }

  /* ── HEADER ── */
  .header { background:linear-gradient(135deg,#001236,#001b60); padding:20px 30px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; }
  .header-left { display:flex; align-items:center; gap:16px; }
  .logo-box { width:52px; height:52px; background:#fff; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:900; color:#001236; box-shadow:0 2px 8px rgba(0,0,0,.2); flex-shrink:0; }
  .h-title { font-size:20px; font-weight:700; color:#fff; }
  .h-sub { font-size:12px; color:#9ecbe8; margin-top:4px; }
  .header-right { display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
  .badge { padding:7px 20px; border-radius:20px; font-size:12px; font-weight:700; text-transform:uppercase; color:#fff; background:#dc3545; border:2px solid rgba(255,255,255,.25); }
  .h-date { font-size:11px; color:#9ecbe8; }

  /* ── CONTENT ── */
  .content { padding:22px 30px 30px; }

  /* ── SECTION TITLE ── */
  .sec { font-size:13px; font-weight:700; color:#001b60; border-left:4px solid #5b81fc; padding-left:10px; margin:22px 0 12px; text-transform:uppercase; letter-spacing:.6px; }

  /* ── KPI ROW ── */
  .kpi-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .kpi { border-radius:8px; padding:14px 10px; text-align:center; color:#fff; }
  .kpi.kc { background:#dc3545; }
  .kpi.kw { background:#d99000; }
  .kpi.kb { background:#001b60; }
  .kpi.kg { background:#6c757d; }
  .kpi .n { font-size:24px; font-weight:900; line-height:1; }
  .kpi .l { font-size:11px; opacity:.9; margin-top:4px; }

  /* ── APPS GRID ── */
  .apps-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .app-card { border-radius:8px; padding:13px 14px; color:#fff; display:flex; flex-direction:column; gap:7px; position:relative; overflow:hidden; }
  .app-card::after { content:''; position:absolute; bottom:-18px; right:-18px; width:70px; height:70px; border-radius:50%; background:rgba(255,255,255,.06); }
  .app-card.critico { background:#dc3545; }
  .app-card.warning { background:#d99000; }
  .app-card.masked  { background:#6c757d; }
  .ac-top { display:flex; justify-content:space-between; align-items:flex-start; gap:6px; }
  .ac-name { font-size:14px; font-weight:700; line-height:1.2; }
  .ac-forn { font-size:9px; font-weight:600; padding:2px 6px; border-radius:8px; background:rgba(255,255,255,.2); display:inline-block; margin-top:2px; }
  .ac-st { font-size:10px; font-weight:700; padding:2px 8px; border-radius:10px; background:rgba(0,0,0,.15); white-space:nowrap; flex-shrink:0; }
  .ac-mt { display:grid; grid-template-columns:repeat(2,1fr); gap:3px 8px; font-size:11px; opacity:.92; }
  .ac-imp { font-size:11px; opacity:.88; line-height:1.45; border-top:1px solid rgba(255,255,255,.18); padding-top:7px; }
  .mask-tag { font-size:10px; font-weight:700; background:rgba(255,255,255,.18); padding:2px 7px; border-radius:8px; display:inline-block; margin-bottom:3px; }

  /* ── CALLOUT ── */
  .callout-crit { background:#fdecea; border:1px solid #f5c6cb; border-left:4px solid #dc3545; border-radius:6px; padding:10px 14px; font-size:11px; color:#7a1a1a; margin-bottom:14px; line-height:1.55; }

  /* ── INFRA ── */
  .infra-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; }
  .infra-card { background:#f8f9fa; border:1px solid #e1e5e9; border-radius:8px; padding:14px 16px; }
  .infra-card.down { background:#fdecea; border-color:#f5c6cb; border-left:4px solid #dc3545; }
  .infra-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:11px; }
  .infra-host { font-size:12px; font-weight:700; color:#001b60; }
  .infra-card.down .infra-host { color:#dc3545; }
  .i-badge { font-size:10px; font-weight:700; padding:2px 9px; border-radius:10px; color:#fff; }
  .i-badge.critico { background:#dc3545; }
  .i-badge.warning { background:#d99000; }
  .i-badge.ok      { background:#28a745; }
  .bar-row { margin-bottom:8px; }
  .bar-info { display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px; color:#555; }
  .bar-info .bv { font-weight:700; }
  .bar-track { width:100%; height:10px; border-radius:5px; background:#e2e6ea; overflow:hidden; }
  .bar-fill { height:100%; border-radius:5px; }
  .bf-ok      { background:#28a745; }
  .bf-warn    { background:#d99000; }
  .bf-crit    { background:#dc3545; }
  .infra-note { font-size:11px; color:#666; margin-top:8px; padding-top:8px; border-top:1px solid #e1e5e9; line-height:1.45; }

  /* ── DB ── */
  .db-wrapper { display:grid; grid-template-columns:3fr 2fr; gap:16px; }
  .db-card { background:#f8f9fa; border:1px solid #e1e5e9; border-radius:8px; padding:14px 16px; }
  .db-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px; }
  .db-title { font-size:13px; font-weight:700; color:#001b60; }
  .db-pills { display:flex; gap:6px; flex-wrap:wrap; }
  .db-pill { font-size:10px; font-weight:700; padding:2px 9px; border-radius:10px; color:#fff; }
  .db-pill.c { background:#dc3545; }
  .db-pill.w { background:#d99000; }
  .db-pill.b { background:#001b60; }
  .db-alert { background:#fff3cd; border:1px solid #f5c842; border-left:4px solid #dc3545; border-radius:6px; padding:8px 12px; font-size:11px; color:#7a4f00; margin-bottom:12px; line-height:1.45; }
  .wait-chart { display:flex; flex-direction:column; gap:7px; }
  .wait-meta { display:flex; justify-content:space-between; font-size:11px; margin-bottom:3px; color:#444; }
  .wn { font-weight:600; }
  .wp { font-weight:700; }
  .db-exec ul { padding-left:0; list-style:none; }
  .db-exec li { font-size:11px; color:#444; margin-bottom:6px; line-height:1.45; padding-left:14px; position:relative; }
  .db-exec li::before { content:'▸'; position:absolute; left:0; color:#001b60; }
  .db-exec .exec-ttl { font-size:12px; font-weight:700; color:#001b60; margin-bottom:8px; }

  /* ── FOOTER ── */
  .footer-bottom { background:#001236; padding:12px 30px; display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#9ecbe8; flex-wrap:wrap; gap:6px; }
  .footer-bottom b { color:#fff; }

  @media(max-width:900px) {
    .kpi-row,.apps-grid,.infra-grid,.db-wrapper { grid-template-columns:1fr; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      <div class="logo-box">SRE</div>
      <div>
        <div class="h-title">${client} · AppDynamics</div>
        <div class="h-sub">Dashboard Diário · ${date}</div>
      </div>
    </div>
    <div class="header-right">
      <div class="badge" style="background: ${score > 7 ? '#28a745' : score > 4 ? '#d99000' : '#dc3545'}">Status: ${honestPhrase.split(',')[0]}</div>
      <div class="h-date">Gerado em ${new Date().toLocaleString('pt-BR')} · Observabilidade</div>
    </div>
  </div>

  <div class="content">
    <div class="sec">Resumo Executivo – ${date}</div>
    <div class="kpi-row">
      <div class="kpi kc"><div class="n">${appCritCount} 🔴</div><div class="l">App Crítica (Health)</div></div>
      <div class="kpi kw"><div class="n">${appWarnCount} 🟠</div><div class="l">Apps em Warning</div></div>
      <div class="kpi kg"><div class="n">${appMaskedCount} ⚪</div><div class="l">Riscos Mascarados</div></div>
      <div class="kpi kb"><div class="n">${sqlMemory}</div><div class="l">Memória SQL</div></div>
    </div>

    <div class="sec">Aplicações – Warning / Crítico + Riscos Mascarados</div>
    ${maskedAlertHtml}
    <div class="apps-grid">
      ${metricsHtml}
    </div>

    <div class="sec">Infraestrutura – Hosts sob Pressão</div>
    ${infraHtml}

    <div class="sec">Banco de Dados ${data.database ? `— ${data.database.name}` : ''}</div>
    ${dbHtml}
  </div>

  <div class="footer-bottom">
    <span><b>SRE Dashboard Solutions</b> · Observability Team · ${date}</span>
  </div>
</div>
</body>
</html>
  `;
}

function calculateScore(data: any) {
  let score = 10;
  data.metrics.forEach((m: any) => {
    if (m.errorRate > 10) score -= 1.5;
    else if (m.errorRate > 5) score -= 0.8;
  });
  data.infra.forEach((i: any) => {
    if (i.ram > 95 || i.swap > 60) score -= 2;
    else if (i.cpu > 90) score -= 1;
  });
  if (data.repeated.length > 0) score -= 1;
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

function getHonestPhrase(score: number) {
  if (score >= 9) return "Operação estável, mas não baixe a guarda.";
  if (score >= 7) return "Ambiente sob controle, com pontos de atenção isolados.";
  if (score >= 5) return "Degradação visível. Risco de escalonamento iminente.";
  if (score >= 3) return "Estado crítico. Equipe deve estar em modo War Room.";
  return "Colapso operacional. Indisponibilidade generalizada detectada.";
}

function getBusinessRisk(entity: string, client: string) {
  const e = entity.toUpperCase();
  if (client.toLowerCase().includes('stellantis')) {
    if (e.includes('MANUFACTURING') || e.includes('PRODUCTION') || e.includes('MES')) return "Risco de paralisação em linha de montagem e produção";
    if (e.includes('SUPPLY') || e.includes('CHAIN')) return "Risco de desabastecimento e gargalo logístico de peças";
    if (e.includes('DEALER') || e.includes('PORTAL')) return "Impacto na rede de concessionárias e pedidos de veículos";
    return "Risco de impacto nas operações industriais / comerciais Stellantis";
  }
  return "Impacto em serviços core não mapeados";
}

export function getNextSteps(data: any) {
  const steps: string[] = [];
  
  const critInfra = data.infra.find((i: any) => i.severityClass === 'critical');
  if (critInfra) {
    steps.push(`Expurgar cache ou reiniciar serviços no host ${critInfra.host} — Swap em ${critInfra.swap}% indica exaustão de memória física.`);
  }

  const maskedApp = data.metrics.find((m: any) => m.tag === '[MASCARADO]');
  if (maskedApp) {
    steps.push(`Investigar falha silenciosa em ${maskedApp.app} — Erro em ${maskedApp.errorRate}% apesar do health GREEN no AppDynamics.`);
  }

  const highWait = data.dbWaits.find((db: any) => db.severity === 'CRITICAL' || db.severity === 'HIGH');
  if (highWait) {
    steps.push(`Analisar planos de execução para ${highWait.type} — Duração de ${highWait.duration}ms impactando performance.`);
  }

  if (steps.length < 3) {
    steps.push("Revisar thresholds de alertas para evitar fadiga de monitoramento.");
  }

  return steps.slice(0, 3);
}
