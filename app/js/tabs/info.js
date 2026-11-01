import { h, block, button } from '../ui.js';

export default {
  id: 'info',
  label: 'Informações',
  title: 'Informações do controle',
  desc: 'Dados lidos diretamente do controle: firmware, endereço Bluetooth e a calibração de fábrica dos sensores.',
  build(app) {
    const { ds, audio } = app;
    const dev = h('dl', { class: 'kv' });
    const fw = h('dl', { class: 'kv' });
    const cal = h('dl', { class: 'kv' });
    const sys = h('dl', { class: 'kv' });
    const kv = (el, rows) => el.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v ?? '—')]));

    const collect = () => ({
      modelo: ds.model, conexao: ds.transport, produto: ds.device?.productName,
      vid: ds.device && '0x' + ds.device.vendorId.toString(16).padStart(4, '0'), pid: ds.device && '0x' + ds.device.productId.toString(16).padStart(4, '0'),
      firmware: ds.firmware, pareamento: ds.pairing, calibracao: ds.calibration?.raw,
      audio: { saida: audio.outputLabel, entrada: audio.inputLabel, canais: audio.ctx?.destination.maxChannelCount },
      navegador: navigator.userAgent,
    });

    const render = () => {
      const f = ds.firmware || {};
      kv(dev, [
        ['Modelo', ds.connected ? ds.model : 'Desconectado'],
        ['Conexão', ds.transport === 'usb' ? 'USB' : ds.transport === 'bt' ? 'Bluetooth' : null],
        ['Nome do produto', ds.device?.productName],
        ['Vendor ID / Product ID', ds.device ? `0x${ds.device.vendorId.toString(16).padStart(4, '0')} / 0x${ds.device.productId.toString(16).padStart(4, '0')}` : null],
        ['Endereço Bluetooth (MAC)', ds.pairing?.mac],
        ['Pareado com o host', ds.pairing?.host],
      ]);
      kv(fw, [
        ['Compilado em', f.buildDate && `${f.buildDate} às ${f.buildTime}`],
        ['Versão do firmware', f.fwVersion],
        ['Versão de atualização', f.updateVersion],
        ['Informação de hardware', f.hwInfo],
        ['Tipo de firmware', f.fwType],
        ['Série do software', f.swSeries],
        ['Versões dos módulos', f.fwVersion1 && `${f.fwVersion1}  ${f.fwVersion2}  ${f.fwVersion3}`],
        ['Vibração melhorada', ds.firmware ? (ds.out.rumbleV2 ? 'Suportada' : 'Não suportada') : null],
      ]);
      const c = ds.calibration?.raw;
      kv(cal, c ? [
        ['Giroscópio: desvio (X, Y, Z)', `${c.pitchBias}, ${c.yawBias}, ${c.rollBias}`],
        ['Giroscópio X: + / −', `${c.pitchPlus} / ${c.pitchMinus}`],
        ['Giroscópio Y: + / −', `${c.yawPlus} / ${c.yawMinus}`],
        ['Giroscópio Z: + / −', `${c.rollPlus} / ${c.rollMinus}`],
        ['Velocidade de referência: + / −', `${c.speedPlus} / ${c.speedMinus} °/s`],
        ['Acelerômetro X: + / −', `${c.accXPlus} / ${c.accXMinus}`],
        ['Acelerômetro Y: + / −', `${c.accYPlus} / ${c.accYMinus}`],
        ['Acelerômetro Z: + / −', `${c.accZPlus} / ${c.accZMinus}`],
      ] : [['Calibração', 'Conecte o controle']]);
      kv(sys, [
        ['WebHID', 'hid' in navigator ? 'Disponível' : 'Indisponível'],
        ['Saída de áudio', audio.outputLabel || (audio.ready ? '—' : 'Áudio não ativado')],
        ['Entrada de áudio', audio.inputLabel],
        ['Canais de saída', audio.ctx ? String(audio.ctx.destination.maxChannelCount) : null],
        ['Taxa de amostragem', audio.ctx ? `${audio.ctx.sampleRate} Hz` : null],
      ]);
    };
    ds.addEventListener('connect', render);
    ds.addEventListener('disconnect', render);
    audio.addEventListener('ready', render);
    render();

    const el = h('div', {},
      block('Controle', '', dev),
      block('Firmware', '', fw),
      block('Calibração de fábrica', 'Valores brutos gravados no controle e usados para converter os sensores em °/s e g.', cal),
      block('Sistema', '', sys),
      h('div', { class: 'row', style: { marginTop: '24px' } },
        button('Copiar tudo como JSON', async () => {
          await navigator.clipboard.writeText(JSON.stringify(collect(), null, 2));
          app.toast('Informações copiadas');
        })),
    );
    return { el, show: render };
  },
};
