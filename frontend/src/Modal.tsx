import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface ModalProps {
  /** Esc ou clique fora. Ausente = modal obrigatório (não fecha sozinho). */
  onClose?: () => void;
  /** Classe do cartão (ex.: "prazo-modal prazo-modal--sm"): o próprio <dialog> é o cartão. */
  className?: string;
  style?: CSSProperties;
  /** id do título, para leitores de tela anunciarem o modal pelo nome */
  labelledBy?: string;
  children: ReactNode;
}

/**
 * Modal com <dialog> nativo: o navegador cuida do Esc, prende o foco do teclado dentro e
 * deixa o resto da página inerte. Ao fechar, o foco volta para quem abriu.
 * Foco inicial: o elemento com data-autofocus (senão o navegador escolhe o primeiro focável).
 */
export default function Modal({ onClose, className = '', style, labelledBy, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const fecharRef = useRef(onClose);
  fecharRef.current = onClose;
  // Só fecha por clique fora se o clique também COMEÇOU fora (selecionar texto e soltar fora não fecha)
  const comecouFora = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const anterior = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (d.open) d.close();
      anterior?.focus?.();
    };
  }, []);

  const fora = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  return (
    <dialog
      ref={ref}
      className={`lx-dialog ${className}`}
      style={style}
      aria-labelledby={labelledBy}
      // Esc: quem decide é o pai (o estado dele é que desmonta o modal)
      onCancel={e => { e.preventDefault(); fecharRef.current?.(); }}
      onMouseDown={e => { comecouFora.current = fora(e); }}
      onClick={e => { if (comecouFora.current && fora(e)) fecharRef.current?.(); comecouFora.current = false; }}
    >
      {children}
    </dialog>
  );
}
