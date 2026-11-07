import {afterEach, expect, it, vi} from 'vitest';
import {copyTransmitterText} from '../transmitter-actions.js';

const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const execCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
afterEach(() => {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else delete navigator.clipboard;
    if (execCommand) Object.defineProperty(document, 'execCommand', execCommand);
    else delete document.execCommand;
});

it('copies on HTTP installations without the Clipboard API and removes its temporary field', async () => {
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
    Object.defineProperty(document, 'execCommand', {configurable: true, value: vi.fn((command) => {
        expect(command).toBe('copy');
        expect(document.activeElement.value).toBe('40.123456, 23.654321');
        expect(document.activeElement.selectionStart).toBe(0);
        expect(document.activeElement.selectionEnd).toBe(20);
        return true;
    })});
    await copyTransmitterText('40.123456, 23.654321');
    expect(document.querySelector('textarea')).toBeNull();
});

it('reports a failed fallback copy and still removes its temporary field', async () => {
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
    Object.defineProperty(document, 'execCommand', {configurable: true, value: () => false});
    await expect(copyTransmitterText('4D2406')).rejects.toThrow('Clipboard unavailable');
    expect(document.querySelector('textarea')).toBeNull();
});
