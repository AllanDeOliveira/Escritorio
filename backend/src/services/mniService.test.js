import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { montarEnvelopeAvisos, parseAvisosPendentes, normalizarDataMni } = require('./mniService');

describe('montarEnvelopeAvisos', () => {
  it('gera envelope SOAP com CPF e senha nos namespaces do MNI 2.2.2', () => {
    const env = montarEnvelopeAvisos({ cpf: '12345678900', senha: 'segredo' });
    expect(env).toContain('consultarAvisosPendentes');
    expect(env).toContain('<tip:idConsultante>12345678900</tip:idConsultante>');
    expect(env).toContain('<tip:senhaConsultante>segredo</tip:senhaConsultante>');
    expect(env).toContain('http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/');
    expect(env).toContain('http://www.cnj.jus.br/tipos-servico-intercomunicacao-2.2.2');
  });

  it('senha vazia (autenticação só por certificado) e escape de XML', () => {
    const env = montarEnvelopeAvisos({ cpf: '123', senha: 'a<b&"c' });
    expect(env).toContain('<tip:senhaConsultante>a&lt;b&amp;&quot;c</tip:senhaConsultante>');
    expect(montarEnvelopeAvisos({ cpf: '123' })).toContain('<tip:senhaConsultante></tip:senhaConsultante>');
  });
});

describe('normalizarDataMni', () => {
  it('converte AAAAMMDDHHMMSS e AAAAMMDD para ISO', () => {
    expect(normalizarDataMni('20260708143000')).toBe('2026-07-08T14:30:00');
    expect(normalizarDataMni('20260708')).toBe('2026-07-08');
  });
  it('mantém valores não reconhecidos e trata vazio', () => {
    expect(normalizarDataMni('2026-07-08')).toBe('2026-07-08');
    expect(normalizarDataMni('')).toBeNull();
  });
});

describe('parseAvisosPendentes', () => {
  it('extrai avisos com campos em atributos (formato comum do PJe)', () => {
    const xml = `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>
<ns2:consultarAvisosPendentesResposta xmlns:ns2="http://www.cnj.jus.br/servico-intercomunicacao-2.2.2/">
  <sucesso>true</sucesso>
  <mensagem>Consulta realizada</mensagem>
  <aviso idAviso="98765" tipoComunicacao="INT" dataDisponibilizacao="20260706120000">
    <destinatario><nome>JESUS VIEIRA DE OLIVEIRA</nome></destinatario>
    <processo numero="11244918220258110041" classeProcessual="156">
      <orgaoJulgador codigoOrgao="41" nomeOrgao="4ª VARA ESP. DA FAZENDA PÚBLICA DE CUIABÁ"/>
    </processo>
  </aviso>
  <aviso idAviso="98766" tipoComunicacao="CIT" dataDisponibilizacao="20260707090000">
    <processo numero="10123546820258110006" classeProcessual="7"/>
  </aviso>
</ns2:consultarAvisosPendentesResposta>
</soap:Body></soap:Envelope>`;

    const r = parseAvisosPendentes(xml);
    expect(r.sucesso).toBe(true);
    expect(r.avisos).toHaveLength(2);
    expect(r.avisos[0]).toMatchObject({
      idAviso: '98765',
      tipoComunicacao: 'INT',
      dataDisponibilizacao: '2026-07-06T12:00:00',
      numeroProcesso: '11244918220258110041',
      orgaoJulgador: '4ª VARA ESP. DA FAZENDA PÚBLICA DE CUIABÁ',
      destinatario: 'JESUS VIEIRA DE OLIVEIRA',
    });
    expect(r.avisos[1].idAviso).toBe('98766');
    expect(r.avisos[1].destinatario).toBeNull();
  });

  it('extrai campos como elementos filhos (variação de implementação)', () => {
    const xml = `<Envelope><Body><resposta>
      <sucesso>true</sucesso>
      <ns3:aviso xmlns:ns3="x">
        <ns3:idAviso>111</ns3:idAviso>
        <ns3:tipoComunicacao>INT</ns3:tipoComunicacao>
        <ns3:processo numero="00453966920158110041"/>
      </ns3:aviso>
    </resposta></Body></Envelope>`;
    const r = parseAvisosPendentes(xml);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0].idAviso).toBe('111');
    expect(r.avisos[0].numeroProcesso).toBe('00453966920158110041');
  });

  it('reporta falha de autenticação sem quebrar', () => {
    const xml = `<Envelope><Body><resposta>
      <sucesso>false</sucesso><mensagem>Usuário ou senha inválidos</mensagem>
    </resposta></Body></Envelope>`;
    const r = parseAvisosPendentes(xml);
    expect(r.sucesso).toBe(false);
    expect(r.mensagem).toContain('inválidos');
    expect(r.avisos).toHaveLength(0);
  });

  it('reporta SOAP Fault', () => {
    const xml = `<Envelope><Body><Fault><faultcode>soap:Server</faultcode>
      <faultstring>Certificado não credenciado</faultstring></Fault></Body></Envelope>`;
    const r = parseAvisosPendentes(xml);
    expect(r.sucesso).toBe(false);
    expect(r.mensagem).toContain('Certificado não credenciado');
  });

  it('resposta vazia/lixo não explode', () => {
    expect(parseAvisosPendentes('').avisos).toHaveLength(0);
    expect(parseAvisosPendentes('<html>erro 500</html>').sucesso).toBe(false);
  });
});
