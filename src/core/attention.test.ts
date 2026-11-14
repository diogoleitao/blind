import { describe, expect, it } from 'vitest'
import { isNotification, programStatus } from './attention'

describe('a notification', () => {
  it('is any OSC 9 but a progress report, `9;4`', () => {
    expect(isNotification(9, 'Claude Code: Waiting for you')).toBe(true)
    expect(isNotification(9, '4;1;50')).toBe(false)
  })

  it('is any OSC 99', () => {
    expect(isNotification(99, 'i=1:d=0:p=title;Claude Code')).toBe(true)
  })

  it('is an OSC 777 `notify`, not the commands others send under 777', () => {
    expect(isNotification(777, 'notify;Claude Code;Waiting for you')).toBe(true)
    expect(isNotification(777, 'precmd')).toBe(false)
  })
})

describe("a program's status report, OSC 7501", () => {
  it('is a query when it asks whether the terminal supports the protocol', () => {
    expect(programStatus('?')).toEqual({ type: 'query' })
  })

  it("reports a record's state, the root record's without an id", () => {
    expect(programStatus('state=done')).toEqual({ type: 'report', id: '', state: 'done' })
    expect(programStatus('state=blocked:kind=permission:id=agents/a1:app=claude-code')).toEqual({
      type: 'report',
      id: 'agents/a1',
      state: 'blocked',
    })
  })

  it('is ignored without a state, or with one the protocol has no name for', () => {
    expect(programStatus('id=a:kind=permission')).toBeUndefined()
    expect(programStatus('state=sleeping')).toBeUndefined()
    expect(programStatus('')).toBeUndefined()
  })

  it('skips malformed pairs and takes the last of a repeated key', () => {
    expect(programStatus('junk::=x:state=working:state=done:id=a')).toEqual({ type: 'report', id: 'a', state: 'done' })
  })

  it('reads a value holding `=`, as base64 padding does', () => {
    expect(programStatus('title=aGk=:state=done:id=a')).toEqual({ type: 'report', id: 'a', state: 'done' })
  })

  it('is ignored whole past a size limit: the sequence, a key, an id segment or the depth of an id', () => {
    const segments = (count: number) => Array.from({ length: count }, () => 'a').join('/')

    expect(programStatus(`state=done:msg=${'a'.repeat(4096)}`)).toBeUndefined()
    expect(programStatus(`state=done:msg=${'é'.repeat(2100)}`)).toBeUndefined()
    expect(programStatus(`state=done:${'k'.repeat(17)}=1`)).toBeUndefined()
    expect(programStatus(`state=done:id=${'a'.repeat(33)}`)).toBeUndefined()
    expect(programStatus(`state=done:id=${segments(9)}`)).toBeUndefined()
    expect(programStatus(`state=done:id=${'a'.repeat(32)}`)).toEqual({ type: 'report', id: 'a'.repeat(32), state: 'done' })
    expect(programStatus(`state=done:id=${segments(8)}`)).toEqual({ type: 'report', id: segments(8), state: 'done' })
  })
})
