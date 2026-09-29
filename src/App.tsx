import React, { useState, useEffect } from 'react';
import { Activity, Server, Database, FileText, Download, Copy, AlertTriangle, Play, Plus, CheckCircle2, XCircle, Loader2, ChevronLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { SREData } from './types';
import { processSRELogic, generateMarkdown, generateHTML } from './services/sreService';
import { cn } from './lib/utils';

// YSSY Logo URLs from user provided images
const YSSY_LOGO = "https://files.oaiusercontent.com/file-2fVjY8z7Z8z7Z8z7Z8z7Z8z7";
const YSSY_ICON = "https://files.oaiusercontent.com/file-4fVjY8z7Z8z7Z8z7Z8z7Z8z7";

interface ClientConfig {
  name: string;
  id: string;
  controllerUrl?: string;
  accountName?: string;
  apiClientName?: string;
  apiClientSecret?: string;
  teamsWebhook?: string;
}

const DEFAULT_CLIENTS: ClientConfig[] = [
  {
    name: "STELLANTIS",
    id: "Stellantis",
    controllerUrl: "https://stellantisglobal-prod.saas.appdynamics.com",
    accountName: "stellantisglobal-prod",
    apiClientName: "automator",
    apiClientSecret: "21bb1476-ea58-458a-a129-29e03cc9f0c4",
    teamsWebhook: ""
  }
];

export default function App() {
  const [view, setView] = useState<'home' | 'report'>('home');
  const [client, setClient] = useState(DEFAULT_CLIENTS[0].id);
  const [clients, setClients] = useState<ClientConfig[]>(() => {
    const saved = localStorage.getItem('sre_clients');
    if (saved) {
      try {
        const parsed: ClientConfig[] = JSON.parse(saved);
        // Clean out old Log-In or Yamaha entries
        const filtered = parsed.filter(c => 
          !c.id.toLowerCase().includes('log-in') && 
          !c.id.toLowerCase().includes('yamaha') &&
          !c.name.toLowerCase().includes('log-in') &&
          !c.name.toLowerCase().includes('yamaha')
        );
        const missingDefaults = DEFAULT_CLIENTS.filter(dc => !filtered.some(c => c.id === dc.id || c.name.toUpperCase() === dc.name.toUpperCase()));
        if (missingDefaults.length > 0) {
          return [...filtered, ...missingDefaults];
        }
        return filtered.length > 0 ? filtered : DEFAULT_CLIENTS;
      } catch (e) {
        return DEFAULT_CLIENTS;
      }
    }
    return DEFAULT_CLIENTS;
  });

  useEffect(() => {
    localStorage.setItem('sre_clients', JSON.stringify(clients));
  }, [clients]);
  const [isAddingClient, setIsAddingClient] = useState(false);
  const [newClient, setNewClient] = useState<Partial<ClientConfig>>({
    name: '',
    controllerUrl: '',
    accountName: '',
    apiClientName: '',
    apiClientSecret: '',
    teamsWebhook: ''
  });
  
  const [validation, setValidation] = useState({
    apm: 'idle' as 'idle' | 'loading' | 'ok' | 'error',
    infra: 'idle' as 'idle' | 'loading' | 'ok' | 'error',
    db: 'idle' as 'idle' | 'loading' | 'ok' | 'error'
  });

  const [report, setReport] = useState<{ md: string; html: string } | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Validate connection when client changes
  useEffect(() => {
    if (view === 'home') {
      validateConnection();
    }
  }, [client, view]);

  const validateConnection = async () => {
    if (!client) return;
    setValidation({ apm: 'loading', infra: 'loading', db: 'loading' });
    
    try {
      const response = await fetch(`/api/test-connection?client=${encodeURIComponent(client)}`);
      const data = await response.json();
      
      if (response.ok && data.success) {
        setValidation({ apm: 'ok', infra: 'ok', db: 'ok' });
      } else {
        setValidation({ apm: 'error', infra: 'error', db: 'error' });
      }
    } catch (e) {
      console.error("Erro ao validar conexão:", e);
      setValidation({ apm: 'error', infra: 'error', db: 'error' });
    }
  };

  const handleGenerateReport = async () => {
    setIsFetching(true);
    const clientConfig = clients.find(c => c.id === client);
    console.log("Iniciando geração de relatório para o cliente:", clientConfig?.name);
    try {
      const response = await fetch('/api/fetch-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientConfig })
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Erro desconhecido" }));
        throw new Error(errData.error || "Falha ao buscar dados da API");
      }
      const data: SREData = await response.json();
      console.log("Dados recebidos da API:", data);

      const processed = processSRELogic(data);
      console.log("Dados processados:", processed);
      
      const md = generateMarkdown(processed, client);
      const html = generateHTML(processed, client);
      
      setReport({ md, html });
      setView('report');
      console.log("Relatório gerado com sucesso!");
    } catch (e: any) {
      console.error("Erro ao gerar relatório:", e);
      alert(`Erro: ${e.message}`);
    } finally {
      setIsFetching(false);
    }
  };

  const handleSendTeams = async () => {
    if (!report) return;
    setIsSending(true);
    try {
      const response = await fetch('/api/send-teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client, markdown: report.md })
      });
      if (!response.ok) throw new Error("Falha ao enviar para o Teams");
      alert("Relatório enviado com sucesso para o Teams!");
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setIsSending(false);
    }
  };

  const handleAddClient = () => {
    if (!newClient.name?.trim()) return;
    const clientToAdd: ClientConfig = {
      ...newClient as ClientConfig,
      id: newClient.name.replace(/\s+/g, '-')
    };
    setClients([...clients, clientToAdd]);
    setNewClient({
      name: '',
      controllerUrl: '',
      accountName: '',
      apiClientName: '',
      apiClientSecret: '',
      teamsWebhook: ''
    });
    setIsAddingClient(false);
    setClient(clientToAdd.id);
  };

  const downloadHTML = () => {
    if (!report) return;
    const blob = new Blob([report.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SRE_Dashboard_${client}_${new Date().toISOString().split('T')[0]}.html`;
    a.click();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Copiado para a área de transferência!");
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header YSSY */}
      <header className="bg-yssy-dark text-white p-4 shadow-xl sticky top-0 z-50 border-b-4 border-yssy-lime">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            {view === 'report' && (
              <button onClick={() => setView('home')} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-yssy-lime to-yssy-blue rounded-lg flex items-center justify-center shadow-inner">
                 <Activity className="w-6 h-6 text-yssy-dark" />
              </div>
              <div className="h-8 w-[1px] bg-yssy-gray/30 mx-1" />
              <div>
                <h1 className="text-lg font-black tracking-tight leading-none uppercase italic">Time de Observabilidade</h1>
                <p className="text-[9px] text-yssy-lime font-bold tracking-[0.3em] mt-1 uppercase opacity-80">SRE Operations Framework</p>
              </div>
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-4">
             <div className="text-right">
                <div className="text-[10px] font-bold text-yssy-gray uppercase tracking-widest">SRE Dashboard</div>
                <div className="text-[10px] font-black text-yssy-lime uppercase">v2.5.0-PRO</div>
             </div>
             <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                <Server className="w-5 h-5 text-yssy-blue" />
             </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6">
        {view === 'home' ? (
          <div className="max-w-3xl mx-auto mt-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="card-yssy p-10 space-y-10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-yssy-lime/5 rounded-full -mr-32 -mt-32 blur-3xl" />
              
              <div className="text-center space-y-3 relative">
                <div className="inline-block px-3 py-1 bg-yssy-lime/10 text-yssy-lime text-[10px] font-black rounded-full uppercase tracking-widest mb-2">
                  Dashboard de Operações Críticas
                </div>
                <h2 className="text-3xl font-black text-yssy-dark uppercase italic tracking-tight">Gerador de Relatórios</h2>
                <p className="text-yssy-gray text-sm max-w-md mx-auto">Selecione o cliente para validar a telemetria e gerar o reporte executivo de SRE.</p>
              </div>

              <div className="space-y-8 relative">
                <div className="space-y-3">
                  <label className="text-xs font-black text-yssy-charcoal uppercase tracking-widest flex items-center gap-2">
                    <Activity className="w-3 h-3 text-yssy-blue" /> Cliente Alvo
                  </label>
                  <div className="flex gap-3">
                    <select 
                      value={client} 
                      onChange={(e) => setClient(e.target.value)}
                      className="flex-1 bg-white border-2 border-yssy-gray/10 px-5 py-4 rounded-2xl text-sm font-bold outline-none focus:ring-4 focus:ring-yssy-blue/10 focus:border-yssy-blue transition-all appearance-none cursor-pointer shadow-sm"
                    >
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button 
                      onClick={() => setIsAddingClient(true)}
                      className="p-4 bg-yssy-dark text-yssy-lime hover:bg-yssy-navy rounded-2xl transition-all shadow-lg hover:shadow-yssy-lime/20 flex items-center justify-center group"
                      title="Cadastrar Novo Cliente"
                    >
                      <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
                    </button>
                  </div>
                </div>

                {/* Validation Status */}
                <div className="space-y-3">
                  <label className="text-xs font-black text-yssy-charcoal uppercase tracking-widest flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-yssy-lime" /> Validação de Conectividade
                  </label>
                  <div className="grid grid-cols-3 gap-4">
                    <StatusIndicator label="APM" status={validation.apm} icon={Activity} />
                    <StatusIndicator label="INFRA" status={validation.infra} icon={Server} />
                    <StatusIndicator label="DB" status={validation.db} icon={Database} />
                  </div>
                </div>

                <div className="pt-6">
                  <button 
                    onClick={handleGenerateReport}
                    disabled={isFetching || validation.apm !== 'ok'}
                    className="w-full btn-yssy-lime py-5 text-lg font-black tracking-tight justify-center shadow-xl hover:shadow-yssy-lime/30 disabled:grayscale"
                  >
                    {isFetching ? (
                      <><Loader2 className="w-6 h-6 animate-spin" /> PROCESSANDO TELEMETRIA...</>
                    ) : (
                      <><Play className="w-6 h-6" /> GERAR RELATÓRIO</>
                    )}
                  </button>
                  {validation.apm === 'error' && (
                    <div className="flex items-center justify-center gap-2 mt-4 text-yssy-critical animate-pulse">
                      <AlertTriangle className="w-4 h-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Erro de Conexão: Falha na autenticação com o Controller
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Add Client Modal */}
            {isAddingClient && (
              <div className="fixed inset-0 bg-yssy-dark/80 backdrop-blur-md flex items-center justify-center z-[100] p-4">
                <div className="bg-white rounded-3xl p-10 w-full max-w-2xl shadow-2xl animate-in zoom-in-95 duration-300 border border-white/20">
                  <div className="flex justify-between items-start mb-8">
                    <div>
                       <h3 className="text-2xl font-black text-yssy-dark uppercase italic">Cadastrar Novo Cliente</h3>
                       <p className="text-yssy-gray text-xs mt-1">Insira as credenciais da API do AppDynamics para o novo ambiente.</p>
                    </div>
                    <button onClick={() => setIsAddingClient(false)} className="p-2 hover:bg-yssy-gray/10 rounded-full transition-colors">
                       <XCircle className="w-6 h-6 text-yssy-gray" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-yssy-gray uppercase tracking-widest">Nome do Cliente</label>
                      <input 
                        type="text" 
                        value={newClient.name}
                        onChange={(e) => setNewClient({...newClient, name: e.target.value})}
                        placeholder="Ex: Stellantis Global"
                        className="w-full bg-yssy-gray/5 border border-yssy-gray/20 p-4 rounded-xl outline-none focus:border-yssy-blue font-bold text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-yssy-gray uppercase tracking-widest">Controller URL</label>
                      <input 
                        type="text" 
                        value={newClient.controllerUrl}
                        onChange={(e) => setNewClient({...newClient, controllerUrl: e.target.value})}
                        placeholder="https://customer.saas.appdynamics.com"
                        className="w-full bg-yssy-gray/5 border border-yssy-gray/20 p-4 rounded-xl outline-none focus:border-yssy-blue font-bold text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-yssy-gray uppercase tracking-widest">Account Name</label>
                      <input 
                        type="text" 
                        value={newClient.accountName}
                        onChange={(e) => setNewClient({...newClient, accountName: e.target.value})}
                        placeholder="customer-prod"
                        className="w-full bg-yssy-gray/5 border border-yssy-gray/20 p-4 rounded-xl outline-none focus:border-yssy-blue font-bold text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-yssy-gray uppercase tracking-widest">API Client Name</label>
                      <input 
                        type="text" 
                        value={newClient.apiClientName}
                        onChange={(e) => setNewClient({...newClient, apiClientName: e.target.value})}
                        placeholder="automator"
                        className="w-full bg-yssy-gray/5 border border-yssy-gray/20 p-4 rounded-xl outline-none focus:border-yssy-blue font-bold text-sm"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-black text-yssy-gray uppercase tracking-widest">API Client Secret</label>
                      <input 
                        type="password" 
                        value={newClient.apiClientSecret}
                        onChange={(e) => setNewClient({...newClient, apiClientSecret: e.target.value})}
                        placeholder="••••••••••••••••••••••••••••••••"
                        className="w-full bg-yssy-gray/5 border border-yssy-gray/20 p-4 rounded-xl outline-none focus:border-yssy-blue font-bold text-sm"
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-black text-yssy-gray uppercase tracking-widest">Teams Webhook URL</label>
                      <input 
                        type="text" 
                        value={newClient.teamsWebhook}
                        onChange={(e) => setNewClient({...newClient, teamsWebhook: e.target.value})}
                        placeholder="https://mteltecno.webhook.office.com/..."
                        className="w-full bg-yssy-gray/5 border border-yssy-gray/20 p-4 rounded-xl outline-none focus:border-yssy-blue font-bold text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex gap-4 mt-10">
                    <button onClick={() => setIsAddingClient(false)} className="flex-1 px-6 py-4 rounded-2xl border-2 border-yssy-gray/10 font-black text-sm uppercase tracking-widest hover:bg-yssy-gray/5 transition-colors">Cancelar</button>
                    <button onClick={handleAddClient} className="flex-1 btn-yssy-primary py-4 text-sm font-black uppercase tracking-widest justify-center shadow-lg hover:shadow-yssy-blue/30">Salvar Cliente</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in duration-700">
            {/* Markdown Checklist */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-yssy-gray flex items-center gap-2">
                  <FileText className="w-4 h-4 text-yssy-blue" /> Checklist Teams (Markdown)
                </h3>
                <button 
                  onClick={() => report && copyToClipboard(report.md)}
                  className="text-[10px] font-black uppercase tracking-widest bg-yssy-gray/10 hover:bg-yssy-gray/20 px-4 py-2 rounded-lg flex items-center gap-2 text-yssy-charcoal transition-all"
                >
                  <Copy className="w-3 h-3" /> Copiar
                </button>
              </div>
              <div className="bg-white border-2 border-yssy-gray/5 p-8 rounded-2xl overflow-auto max-h-[750px] prose prose-sm max-w-none shadow-inner custom-scrollbar">
                <ReactMarkdown>{report?.md || ''}</ReactMarkdown>
              </div>
            </div>

            {/* HTML Preview */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-yssy-gray flex items-center gap-2">
                  <Activity className="w-4 h-4 text-yssy-lime" /> OnePage Dashboard (Preview)
                </h3>
                <div className="flex gap-3">
                  <button 
                    onClick={handleSendTeams}
                    disabled={isSending}
                    className="text-[10px] font-black uppercase tracking-widest bg-yssy-navy hover:bg-yssy-dark px-4 py-2 rounded-lg flex items-center gap-2 text-white disabled:opacity-50 transition-all shadow-md"
                  >
                    {isSending ? "ENVIANDO..." : <><Copy className="w-3 h-3" /> Enviar Teams</>}
                  </button>
                  <button 
                    onClick={() => {
                      if (!report) return;
                      const blob = new Blob([report.html], { type: 'text/html' });
                      const url = URL.createObjectURL(blob);
                      window.open(url, '_blank');
                    }}
                    className="text-[10px] font-black uppercase tracking-widest bg-yssy-blue hover:bg-yssy-navy px-4 py-2 rounded-lg flex items-center gap-2 text-white transition-all shadow-md"
                  >
                    <Activity className="w-3 h-3" /> Ver OnePage
                  </button>
                  <button 
                    onClick={downloadHTML}
                    className="text-[10px] font-black uppercase tracking-widest btn-yssy-lime px-4 py-2 rounded-lg flex items-center gap-2 shadow-md"
                  >
                    <Download className="w-3 h-3" /> Download HTML
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-2xl overflow-hidden shadow-2xl border-4 border-yssy-dark h-[750px]">
                <iframe 
                  srcDoc={report?.html || ''} 
                  className="w-full h-full border-none"
                  title="Dashboard Preview"
                />
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-yssy-dark text-white p-8 mt-auto border-t-4 border-yssy-lime">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 bg-white/10 rounded flex items-center justify-center">
                <Activity className="w-4 h-4 text-yssy-lime" />
             </div>
             <div>
                <span className="text-[10px] uppercase tracking-[0.3em] text-yssy-gray font-black block">SRE Observability Team Framework</span>
                <span className="text-[8px] text-yssy-lime/50 uppercase font-bold">Critical Infrastructure Monitoring</span>
             </div>
          </div>
          <div className="flex gap-8 text-[9px] font-black text-yssy-gray uppercase tracking-[0.2em]">
            <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yssy-lime animate-pulse" /> Status: Operacional</span>
            <span className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-yssy-blue" /> API: Connected</span>
            <span className="text-yssy-lime/30">v2.5.0-PRO</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StatusIndicator({ label, status, icon: Icon }: { label: string; status: 'idle' | 'loading' | 'ok' | 'error', icon: React.ElementType }) {
  return (
    <div className="flex flex-col items-center justify-center p-6 rounded-3xl bg-yssy-gray/5 border-2 border-yssy-gray/5 space-y-3 transition-all hover:bg-white hover:shadow-lg hover:border-yssy-blue/10 group">
      <div className={cn(
        "p-3 rounded-xl transition-all",
        status === 'ok' ? "bg-yssy-lime/10 text-yssy-lime" : 
        status === 'error' ? "bg-yssy-critical/10 text-yssy-critical" : 
        "bg-yssy-gray/10 text-yssy-gray"
      )}>
        <Icon className="w-5 h-5" />
      </div>
      <span className="text-[10px] font-black text-yssy-gray uppercase tracking-widest group-hover:text-yssy-dark transition-colors">{label}</span>
      
      <div className="flex items-center gap-2">
        {status === 'loading' && <Loader2 className="w-4 h-4 text-yssy-blue animate-spin" />}
        {status === 'ok' && <CheckCircle2 className="w-4 h-4 text-yssy-lime" />}
        {status === 'error' && <XCircle className="w-4 h-4 text-yssy-critical" />}
        {status === 'idle' && <div className="w-4 h-4 rounded-full border-2 border-dashed border-yssy-gray/30" />}
        
        <span className={cn(
          "text-[9px] font-black uppercase tracking-widest",
          status === 'ok' ? "text-yssy-lime" : status === 'error' ? "text-yssy-critical" : "text-yssy-gray"
        )}>
          {status === 'loading' ? 'Validando' : status === 'ok' ? 'OK' : status === 'error' ? 'Falha' : 'Aguardando'}
        </span>
      </div>
    </div>
  );
}
