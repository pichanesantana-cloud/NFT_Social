import React, { useEffect, useState } from 'react';
import './App.css';
import { SuiClient } from '@mysten/sui.js/client';
import { TransactionBlock } from '@mysten/sui.js/transactions';

function App() {
  const [rpc, setRpc] = useState('https://fullnode.testnet.sui.io:443');
  const [provider, setProvider] = useState(() => new SuiClient({ url: rpc }));
  // package/object id do pacote Move (ex: 0x...)
  const [pkg, setPkg] = useState('0x0c0ebaa41608123300f948b392640b258ab9db1031d83341b8bf507e4c00a2a8');
  const [account, setAccount] = useState('');
  const [status, setStatus] = useState('');
  const [lastResult, setLastResult] = useState(null);
  const [nfts, setNfts] = useState([]);

  const [creatorName, setCreatorName] = useState('Creator');
  const [creatorHandle, setCreatorHandle] = useState('handle');
  const [recipient, setRecipient] = useState('');
  const [xpAmount, setXpAmount] = useState('100');
  const [nftObjectId, setNftObjectId] = useState('');

  useEffect(() => {
    setProvider(new SuiClient({ url: rpc }));
  }, [rpc]);

  // Nota: small attempts at connecting to injected Sui wallet. APIs vary between wallets.
  // We try window.sui.connect() and window.sui.getAccounts() if disponíveis.
  const connectWallet = async () => {
    try {
      if (!window.sui) {
        setStatus('Sui wallet não detectada no navegador (window.sui undefined). Verifique se a extensão está instalada e ativada.');
        setLastResult({ windowSui: false });
        return;
      }

      // mostrar chaves/métodos expostos pela wallet para diagnóstico
      const exportedKeys = Object.keys(window.sui).filter((k) => typeof window.sui[k] !== 'function');
      const exportedFuncs = Object.keys(window.sui).filter((k) => typeof window.sui[k] === 'function');
      setLastResult({ exportedKeys, exportedFuncs });

      // tentar conectar pela API padrão
      if (window.sui.connect) {
        await window.sui.connect();
      }

      // obter contas: usar getAccounts se existir; algumas wallets oferecem getAccounts ou request
      let accs = [];
      if (window.sui.getAccounts) {
        try { accs = await window.sui.getAccounts(); } catch (err) { console.warn('getAccounts falhou', err); }
      }
      if ((!accs || accs.length === 0) && window.sui.request) {
        try {
          // algumas implementações seguem padrão RPC interno
          const resp = await window.sui.request({ method: 'sui_getAccounts' });
          if (Array.isArray(resp)) accs = resp;
        } catch (err) { console.warn('request sui_getAccounts falhou', err); }
      }

      const addr = (accs && accs.length) ? accs[0] : (window.sui.account || '');
      if (addr) {
        setAccount(addr);
        setStatus('Conectado: ' + addr);
      } else {
        setStatus('Conexão estabelecida com a extensão, mas nenhuma conta retornada. Verifique se a wallet está desbloqueada e na rede correta.');
      }
    } catch (e) {
      console.error(e);
      setStatus('Erro ao conectar: ' + (e.message || String(e)));
      setLastResult({ error: String(e), stack: e.stack });
    }
  };

  // Helper: create a TransactionBlock for mint or add_xp. We will try to sign+execute if wallet
  // is available, otherwise use devInspect (simulação) via provider.
  const mintNFT = async () => {
    setStatus('Preparando transação de mint...');
    try {
      if (!pkg) { setStatus('Informe o package address do módulo Move primeiro.'); return; }
      const tx = new TransactionBlock();
      const nameBytes = Array.from(new TextEncoder().encode(creatorName || 'Creator'));
      const handleBytes = Array.from(new TextEncoder().encode(creatorHandle || 'handle'));

      // tentar encontrar um AdminCap que a conta possua e passar como primeiro argumento
      let adminObjectArg = null;
      try {
        const owned = await provider.getOwnedObjects({ owner: account, options: { showType: true } });
        let items = Array.isArray(owned) ? owned : (owned?.data || owned?.result || []);
        for (const it of items) {
          const objectId = it?.objectId || it?.object?.objectId || it?.objectId;
          const typeStr = it?.objectType || it?.type || it?.object?.type || it?.object?.objectType;
          if (objectId && String(typeStr).includes('::social_creator::AdminCap')) { adminObjectArg = objectId; break; }
        }
      } catch (e) {
        // ignore
      }

      const args = [];
      if (adminObjectArg) args.push(tx.object(adminObjectArg));
      args.push(tx.pure(nameBytes));
      args.push(tx.pure(handleBytes));
      args.push(tx.pure(recipient || account || '0x0'));

      tx.moveCall({
        target: `${pkg}::social_creator::mint_social_nft`,
        arguments: args,
      });

      // If there's an injected wallet with signAndExecuteTransactionBlock, try to use it.
      if (window.sui && window.sui.signAndExecuteTransactionBlock) {
        setStatus('Enviando transação (wallet)...');
        const res = await window.sui.signAndExecuteTransactionBlock({ transactionBlock: tx });
        setLastResult(res);
        setStatus('Transação enviada. Digest: ' + (res.digest || 'n/a'));
        // tentar atualizar lista de NFTs do usuário após publicação
        setTimeout(() => { try { listMyNFTs(); } catch {} }, 1500);
      } else {
        // fall back to simulation (devInspect)
        setStatus('Simulando transação com devInspect...');
        const res = await provider.devInspectTransactionBlock({ transactionBlock: tx, sender: account || '0x0' });
        setLastResult(res);
        setStatus('Simulação completa. Veja resultado abaixo.');
      }
    } catch (e) {
      console.error(e);
      setStatus('Erro mint: ' + (e.message || e));
    }
  };

  const listMyNFTs = async () => {
    setStatus('Listando NFTs da conta...');
    try {
      if (!account) { setStatus('Conecte a wallet primeiro.'); return; }
      // obter owned objects do owner
      const owned = await provider.getOwnedObjects({ owner: account, options: { showType: true } });
      // resposta pode vir em várias formas; normalizamos para um array de objetos
      let items = [];
      if (Array.isArray(owned)) items = owned; else if (owned?.data) items = owned.data; else items = owned?.result || [];

      const found = [];
      for (const it of items) {
        // tentar extrair object id e type
        const objectId = it?.objectId || it?.object?.objectId || it?.objectId || it?.reference?.objectId;
        const objType = it?.objectType || it?.type || it?.object?.type || it?.object?.objectType;
        if (!objectId || !objType) continue;
        if (String(objType).includes('::social_creator::NFTSOCIAL')) {
          // pegar conteúdo do objeto para extrair campos
          const detail = await provider.getObject({ id: objectId, options: { showContent: true } });
          // o conteúdo pode estar em detail?.data?.content?.fields
          const fields = detail?.data?.content?.fields || detail?.content?.fields || (detail?.details?.data?.content?.fields) || {};
          // campos esperados: creator_name (vector<u8> / string), creator_handle, xp, level
          const creator_name = fields?.creator_name || fields?.creator_name || '';
          const creator_handle = fields?.creator_handle || '';
          const xp = fields?.xp || fields?.xp || 0;
          const level = fields?.level || fields?.level || 0;
          found.push({ objectId, creator_name, creator_handle, xp, level, raw: detail });
        }
      }
      setNfts(found);
      setStatus(`Encontrados ${found.length} NFTs.`);
    } catch (e) {
      console.error(e);
      setStatus('Erro ao listar NFTs: ' + (e.message || e));
    }
  };

  const addXP = async () => {
    setStatus('Preparando transação add_xp...');
    try {
      if (!pkg) { setStatus('Informe o package address do módulo Move primeiro.'); return; }
      if (!nftObjectId) { setStatus('Informe o object id do NFT a atualizar (nftObjectId).'); return; }
      const tx = new TransactionBlock();
      // primeiro argumento: &mut NFTSOCIAL object
      tx.moveCall({
        target: `${pkg}::social_creator::add_xp`,
        arguments: [tx.object(nftObjectId), tx.pure(Number(xpAmount))],
      });

      if (window.sui && window.sui.signAndExecuteTransactionBlock) {
        setStatus('Enviando transação (wallet)...');
        const res = await window.sui.signAndExecuteTransactionBlock({ transactionBlock: tx });
        setLastResult(res);
        setStatus('Transação enviada. Digest: ' + (res.digest || 'n/a'));
      } else {
        setStatus('Simulando transação com devInspect...');
        const res = await provider.devInspectTransactionBlock({ transactionBlock: tx, sender: account || '0x0' });
        setLastResult(res);
        setStatus('Simulação completa. Veja resultado abaixo.');
      }
    } catch (e) {
      console.error(e);
      setStatus('Erro add_xp: ' + (e.message || e));
    }
  };

  const inspectGetters = async () => {
    setStatus('Tentando inspecionar getters (simulação)...');
    try {
      if (!pkg) { setStatus('Informe o package address do módulo Move primeiro.'); return; }
      if (!nftObjectId) { setStatus('Informe o object id do NFT a consultar (nftObjectId).'); return; }

      // Chamada para get_xp: public fun get_xp(nft: &NFTSOCIAL): u64
      const tx = new TransactionBlock();
      tx.moveCall({
        target: `${pkg}::social_creator::get_xp`,
        arguments: [tx.object(nftObjectId)],
      });

      const res = await provider.devInspectTransactionBlock({ transactionBlock: tx, sender: account || '0x0' });
      setLastResult(res);
      setStatus('Inspeção completa (devInspect).');
    } catch (e) {
      console.error(e);
      setStatus('Erro inspect: ' + (e.message || e));
    }
  };

  return (
    <div className="App" style={{ padding: 20 }}>
      <h2>NFT Social — UI mínima (teste)</h2>
      <div style={{ marginBottom: 10 }}>
        <label>RPC URL: </label>
        <input value={rpc} onChange={(e) => setRpc(e.target.value)} style={{ width: 420 }} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label>Package address (ex: 0x...): </label>
        <input value={pkg} onChange={(e) => setPkg(e.target.value)} style={{ width: 300 }} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <button onClick={connectWallet}>Connect Wallet</button>
        <span style={{ marginLeft: 10 }}>{account ? `Conta: ${account}` : ''}</span>
      </div>

      <hr />

      <h3>Mint NFT</h3>
      <div>
        <label>Creator name: </label>
        <input value={creatorName} onChange={(e) => setCreatorName(e.target.value)} />
      </div>
      <div>
        <label>Creator handle: </label>
        <input value={creatorHandle} onChange={(e) => setCreatorHandle(e.target.value)} />
      </div>
      <div>
        <label>Recipient address (opcional — usa conta conectada): </label>
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} style={{ width: 300 }} />
      </div>
      <div style={{ marginTop: 8 }}>
        <button onClick={mintNFT}>Mint (simular/enviar)</button>
      </div>

      <div style={{ marginTop: 8 }}>
        <button onClick={listMyNFTs}>Listar meus NFTs</button>
      </div>

      <hr />

      <h3>Add XP</h3>
      <div>
        <label>NFT object id: </label>
        <input value={nftObjectId} onChange={(e) => setNftObjectId(e.target.value)} style={{ width: 420 }} />
      </div>
      <div>
        <label>XP amount: </label>
        <input value={xpAmount} onChange={(e) => setXpAmount(e.target.value)} />
      </div>
      <div style={{ marginTop: 8 }}>
        <button onClick={addXP}>Add XP (simular/enviar)</button>
        <button onClick={inspectGetters} style={{ marginLeft: 8 }}>Simular getters (get_xp)</button>
      </div>

      <hr />

      <div>
        <strong>Status:</strong> {status}
      </div>
      <div style={{ marginTop: 10 }}>
        <strong>Último resultado (console / JSON):</strong>
        <pre style={{ maxHeight: 300, overflow: 'auto', background: '#f5f5f5', padding: 8 }}>
          {lastResult ? JSON.stringify(lastResult, null, 2) : '—'}
        </pre>
      </div>

      <div style={{ marginTop: 10 }}>
        <h3>Meus NFTs</h3>
        <div style={{ marginBottom: 8 }}>
          <strong>Quantidade:</strong> {nfts.length}
        </div>
        <div>
          {nfts.length === 0 && <div>Nenhum NFT encontrado (clique em "Listar meus NFTs").</div>}
          {nfts.map((n) => (
            <div key={n.objectId} style={{ border: '1px solid #ddd', padding: 8, marginBottom: 8 }}>
              <div><strong>Object ID:</strong> {n.objectId}</div>
              <div><strong>Creator:</strong> {String(n.creator_name)}</div>
              <div><strong>Handle:</strong> {String(n.creator_handle)}</div>
              <div><strong>XP:</strong> {String(n.xp)}</div>
              <div><strong>Level:</strong> {String(n.level)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, color: '#555' }}>
        <p>Observações:</p>
        <ul>
          <li>Esta UI é mínima e tenta usar a Sui Wallet injetada (se disponível) para assinar/transacionar.</li>
          <li>Sem wallet, as ações usarão devInspect (simulação) contra o RPC configurado.</li>
          <li>Algumas chamadas (por exemplo mint) podem requerer uma AdminCap/objeto específico — verifique se o pacote está publicado e se há objetos/AdminCap disponíveis.</li>
          <li>Se quiser, eu posso complementar para publicar o pacote em devnet/testnet e criar os objetos necessários.</li>
        </ul>
      </div>
    </div>
  );
}

export default App;
