import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIRPORTS, CRAG_NOTCH, HARROW_FIELD } from '../shared/Airports'
import { PHONETIC, atcPhrase, atisLetter, atisText, cloudPhrase, runwayInUse, visibilityPhrase, windPhrase } from '../shared/Atc'
import { createWeatherState, weatherAt } from '../shared/Weather'

test('the runway in use is the landing end with the most headwind', () => {
  for (const airport of AIRPORTS) {
    if (airport === CRAG_NOTCH) continue
    const runway = airport.runways[0]
    const into = runwayInUse(airport, runway.heading, 8)
    assert.equal(into.name, runway.ends[0], `${airport.id} wind down the low end`)
    assert.ok(into.headwind > 7.9 && into.crosswind < 0.1)
    const other = runwayInUse(airport, (runway.heading + 180) % 360, 8)
    assert.equal(other.name, runway.ends[1], `${airport.id} wind down the high end`)
  }
  assert.equal(runwayInUse(CRAG_NOTCH, (CRAG_NOTCH.runways[0].heading + 180) % 360, 10).name, CRAG_NOTCH.runways[0].ends[0], 'Crag Notch lands one way')
})

test('ATIS reads the conditions, the runway and a letter that changes with the hour', () => {
  const weather = weatherAt('rain', 1, 0, createWeatherState())
  const atis = atisText(HARROW_FIELD, { hourOfDay: 14.4, windFrom: 270, windSpeed: 6, gust: 4, weather, temperature: 12.4, pressure: 101325 })
  assert.ok(PHONETIC.includes(atis.letter))
  assert.match(atis.text, /^Harrow Field information \w+, time 1420\./)
  assert.match(atis.text, /Wind 270 at 12 gusting 19/)
  assert.match(atis.text, /visibility 5 kilometres, rain/)
  assert.match(atis.text, /overcast/)
  assert.match(atis.text, /temperature 12, altimeter 29\.92/)
  assert.match(atis.text, new RegExp(`runway ${atis.runway.name}\\.`))
  assert.notEqual(atisLetter(HARROW_FIELD, 14), atisLetter(HARROW_FIELD, 15))
  assert.notEqual(atisLetter(HARROW_FIELD, 14), atisLetter(AIRPORTS[1], 14))
})

test('the phrases read naturally', () => {
  assert.equal(windPhrase(90, 1, 0), 'wind calm')
  assert.equal(windPhrase(4, 5, 0), 'wind 360 at 10')
  assert.equal(visibilityPhrase(60000), 'visibility 10 kilometres or more')
  assert.equal(visibilityPhrase(900), 'visibility 900 metres')
  assert.equal(cloudPhrase(weatherAt('clear', 1, 0, createWeatherState())), 'sky clear')
  assert.equal(cloudPhrase(weatherAt('fog', 1, 0, createWeatherState())), 'fog')
  const runway = runwayInUse(HARROW_FIELD, 270, 5)
  assert.match(atcPhrase('takeoff', 'Wren T4', HARROW_FIELD, runway, { wind: 'wind 270 at 10' }), /^Wren T4, wind 270 at 10, runway \d\d, cleared for take-off\.$/)
  assert.match(atcPhrase('final', 'Northline 214', HARROW_FIELD, runway), /cleared to land\.$/)
  for (const event of ['taxi', 'lineup', 'departure', 'inbound', 'landing', 'vacate', 'goaround'] as const) {
    assert.ok(atcPhrase(event, 'Wren T4', HARROW_FIELD, runway).startsWith('Wren T4,'), event)
  }
})
