import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseLista, linksA4j, alvoPermitido, decodificar, melhorExpediente, formatarCnj } = require('./pjePainel');

// Estrutura real do painel (TRF1, set/2026), com dados fictícios
const linha = (miolo) => `<tr class="rich-table-row rich-table-firstrow"><td>${miolo}</td></tr>`;
const LISTA = `<span>3 resultados encontrados</span><table><tbody>
${linha(`<a>Responder</a><span>FULANO DE TAL</span><span>Intima&ccedil;&atilde;o (470034294)</span>
  <span>Di&aacute;rio Eletr&ocirc;nico (</span><span>04/09/2026 17:35</span><span>)</span>
  <span>Prazo:15 dias</span><span>O sistema registrou ci&ecirc;ncia em 08/09/2026 00:00</span>
  <span>Data limite prevista para manifesta&ccedil;&atilde;o: 29/09/2026 23:59</span>
  <a>CumSenFaz 0000560-57.2008.4.01.3601</a><span>FULANO DE TAL X INSTITUTO NACIONAL DO SEGURO SOCIAL</span>
  <span>/1&ordf; Vara Federal de C&aacute;ceres-MT</span>`)}
${linha(`<a>Responder</a><span>BELTRANA</span><span>Intima&ccedil;&atilde;o (469958812)</span>
  <span>Di&aacute;rio Eletr&ocirc;nico (</span><span>03/09/2026 14:36</span><span>)</span>
  <span>Prazo: sem prazo</span><span>O sistema registrou ci&ecirc;ncia em 08/09/2026 00:00</span>
  <a>PJEC 1003965-54.2026.4.01.3601</a>`)}
${linha(`<a>&gt;</a><a>Tomar ci&ecirc;ncia</a><span>CICRANO</span><span>Decis&atilde;o (471177217)</span>
  <span>Di&aacute;rio Eletr&ocirc;nico (</span><span>28/09/2026 11:53</span><span>)</span>
  <span>Prazo:10 dias</span><span>Data limite prevista para ci&ecirc;ncia: (c&aacute;lculo em processamento)</span>
  <a>PJEC 1003411-56.2025.4.01.3601</a>`)}
</tbody></table>`;

describe('parseLista', () => {
    const { total, itens } = parseLista(LISTA);

    it('lê todos os expedientes, inclusive os pendentes de ciência', () => {
        expect(total).toBe(3);
        expect(itens.map((i) => i.idExpediente)).toEqual(['470034294', '469958812', '471177217']);
    });

    it('usa a data limite do PJe', () => {
        const [a] = itens;
        expect(a).toMatchObject({
            tipo: 'Intimação', destinatario: 'FULANO DE TAL', meio: 'Diário Eletrônico', prazoDias: 15,
            cienciaPendente: false, numeroProcesso: '00005605720084013601', orgao: '1ª Vara Federal de Cáceres-MT',
        });
        expect(a.dataLimite).toEqual(new Date(2026, 8, 29));
        expect(a.dataCiencia).toEqual(new Date(2026, 8, 8));
    });

    it('"sem prazo" e ciência pendente ficam sem data limite', () => {
        expect(itens[1]).toMatchObject({ prazoDias: null, dataLimite: null, cienciaPendente: false });
        expect(itens[2]).toMatchObject({ prazoDias: 10, dataLimite: null, dataCiencia: null, cienciaPendente: true, destinatario: 'CICRANO' });
    });
});

describe('segurança: só clica na árvore', () => {
    it('aceita situação, jurisdição, caixa e paginação', () => {
        expect(alvoPermitido('formAbaExpediente:listaAgrSitExp:0:j_id183')).toBe(true);
        expect(alvoPermitido('formAbaExpediente:listaAgrSitExp:0:trPend:38::jNp')).toBe(true);
        expect(alvoPermitido('formAbaExpediente:listaAgrSitExp:0:trPend:38:-1::j_id191:cxExItem')).toBe(true);
        expect(alvoPermitido('formExpedientes:tbExpedientes:scPendentes')).toBe(true);
    });

    it('recusa "Tomar ciência" e "Responder"', () => {
        expect(alvoPermitido('formExpedientes:tbExpedientes:471089565:j_id565')).toBe(false);
        expect(alvoPermitido('formExpedientes:tbExpedientes:470034294:j_id567')).toBe(false);
        expect(alvoPermitido(undefined)).toBe(false);
    });
});

describe('linksA4j', () => {
    it('extrai form, parâmetros e contador', () => {
        const html = `<a href="#" onclick="A4J.AJAX.Submit('formAbaExpediente',event,{'parameters':{'formAbaExpediente:listaAgrSitExp:0:trPend:38::jNp':'formAbaExpediente:listaAgrSitExp:0:trPend:38::jNp','ajaxSingle':'formAbaExpediente:listaAgrSitExp:0:trPend:38::jNp'}});return false;"><span>Subse&ccedil;&atilde;o de C&aacute;ceres-MT</span><span>30</span></a>`;
        const [l] = linksA4j(html);
        expect(l).toMatchObject({ rotulo: 'Subseção de Cáceres-MT', total: 30, form: 'formAbaExpediente' });
        expect(l.params.ajaxSingle).toBe('formAbaExpediente:listaAgrSitExp:0:trPend:38::jNp');
    });

    it('decodifica entidades e o escape \\x2D do id da caixa', () => {
        expect(decodificar('Ci&ecirc;ncia &amp; Manifesta&ccedil;&atilde;o')).toBe('Ciência & Manifestação');
        const html = `<a onclick="A4J.AJAX.Submit('f:38:\\x2D1::j_id191',event,{'parameters':{'ajaxSingle':'x:38:\\x2D1::j_id191:cxExItem'}})">Caixa de entrada</a><span>29</span>`;
        expect(linksA4j(html)[0]).toMatchObject({ form: 'f:38:-1::j_id191', total: 29 });
    });
});

describe('expediente ↔ intimação', () => {
    it('escolhe o expediente de expedição mais próxima da disponibilização', () => {
        const exps = [
            { id: 'antigo', dataExpedicao: new Date(2026, 7, 1) },
            { id: 'certo', dataExpedicao: new Date(2026, 8, 25) },
            { id: 'sem-data', dataExpedicao: null },
        ];
        expect(melhorExpediente({ dataDisponibilizacao: new Date(2026, 8, 26) }, exps).id).toBe('certo');
        expect(melhorExpediente({ dataDisponibilizacao: new Date(2026, 8, 26) }, [])).toBeNull();
    });

    it('formata o número CNJ igual ao DJEN', () => {
        expect(formatarCnj('00005605720084013601')).toBe('0000560-57.2008.4.01.3601');
        expect(formatarCnj('123')).toBe('123');
        expect(formatarCnj(null)).toBeNull();
    });
});
