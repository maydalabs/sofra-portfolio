import assert from 'node:assert/strict'
import test from 'node:test'

import { assertLocalFixtureTarget } from './fixture-target.mjs'

test('accepts explicit local PostgreSQL fixture targets', () => {
  for (const url of [
    'postgres://sofra:example@127.0.0.1:54329/sofra',
    'postgresql://sofra:example@localhost:54329/sofra',
    'postgres://localhost/sofra',
    'postgresql://LOCALHOST/sofra',
    'postgres://example%40user:p%40ss%2Cword%3F@localhost/sofra',
  ]) {
    assert.equal(assertLocalFixtureTarget(url), url)
  }
})

test('rejects misleading local prefixes, remote hosts, and multihost URLs', () => {
  for (const url of [
    'postgres://example:example@localhost.example.org/sofra',
    'postgres://example:example@127.0.0.1.example.org/sofra',
    'postgres://example:example@db.example.org/sofra',
    'postgres://example:example@localhost,db.example.org/sofra',
    'postgres://example:example@localhost%2Cdb.example.org/sofra',
    'postgres://example:example@localhost./sofra',
    'postgres://example:example@[::1]/sofra',
    'postgres://example:example@127.1/sofra',
  ]) {
    assert.throws(
      () => assertLocalFixtureTarget(url),
      /Fixture loading requires/,
    )
  }
})

test('rejects userinfo and path text pretending to identify a local host', () => {
  for (const url of [
    'postgres://example@localhost:example@db.example.org/sofra',
    'postgres://example@db.example.org:example@localhost/sofra',
    'postgres://example:example@db.example.org/sofra/@localhost',
    'postgres://localhost:example@db.example.org/sofra',
  ]) {
    assert.throws(
      () => assertLocalFixtureTarget(url),
      /Fixture loading requires/,
    )
  }
})

test('rejects every query override and fragment, including encoded keys', () => {
  for (const suffix of [
    '?host=db.example.org',
    '?hostname=db.example.org',
    '?user=other',
    '?username=other',
    '?password=other',
    '?database=other',
    '?options=-c%20search_path%3Dother',
    '?%75ser=other',
    '?sslmode=disable',
    '?',
    '#fragment',
    '#',
  ]) {
    assert.throws(
      () => assertLocalFixtureTarget(`postgres://localhost/sofra${suffix}`),
      /Fixture loading requires/,
    )
  }
})

test('rejects missing, malformed, and non-PostgreSQL URLs', () => {
  for (const url of [
    undefined,
    null,
    123,
    '',
    'localhost',
    'postgres:///sofra',
    'postgres://localhost:wrong/sofra',
    'postgres://localhost:0/sofra',
    'postgres://localhost:65536/sofra',
    'postgres://example:%ZZ@localhost/sofra',
    'postgres://localhost/bad%ZZname',
    ' postgres://localhost/sofra',
    'postgres://local\nhost/sofra',
    'https://example:example@localhost/sofra',
    'mysql://example:example@localhost/sofra',
    'file://localhost/sofra',
  ]) {
    assert.throws(
      () => assertLocalFixtureTarget(url),
      /Fixture loading requires/,
    )
  }
})

test('errors do not reveal credentials or parser input', () => {
  const credential = 'private-value-for-redaction-test'
  for (const url of [
    `postgres://example:${credential}@db.example.org/sofra`,
    `postgres://example:${credential}%ZZ@localhost/sofra`,
  ]) {
    assert.throws(
      () => assertLocalFixtureTarget(url),
      (error) => {
        assert.ok(error instanceof Error)
        assert.ok(!error.message.includes(credential))
        assert.ok(!error.message.includes(url))
        return true
      },
    )
  }
})
