"""Scenario generation is a pure function of the seed and varies across seeds."""

from app.simulation.scenario_generator import generate_scenario


def test_same_seed_same_scenario():
    a = generate_scenario(1234)
    b = generate_scenario(1234)
    assert a.model_dump() == b.model_dump()
    assert a.scenario_id == b.scenario_id


def test_different_seeds_produce_different_scenarios():
    ids = {generate_scenario(seed).scenario_id for seed in range(40)}
    assert len(ids) == 40


def test_randomized_dimensions_cover_the_spec():
    scenarios = [generate_scenario(seed) for seed in range(80)]
    assert {len(s.satellites) for s in scenarios} == {4, 5}
    assert {len(s.ground_stations) for s in scenarios} == {1, 2}
    assert len({s.failure.satellite_id for s in scenarios}) >= 4
    assert len({s.failure.pattern for s in scenarios}) == 3
    assert len({s.failure.cause.split(":")[0] for s in scenarios}) >= 4
    assert len({s.post_solve_bundles for s in scenarios}) >= 2
    latencies = {link.latency_ms for s in scenarios for link in s.links}
    assert len(latencies) > 50


def test_topology_shape():
    for seed in range(30):
        s = generate_scenario(seed)
        sat_ids = [sat.id for sat in s.satellites]
        ground = [l for l in s.links if l.kind == "ground"]
        isl = [l for l in s.links if l.kind == "isl"]
        # every satellite has exactly one ground link to its home station
        assert sorted(l.source for l in ground) == sorted(sat_ids)
        for sat in s.satellites:
            assert any(l.source == sat.id and l.target == sat.ground_station_id for l in ground)
        # ISLs chain neighbouring satellites
        assert [(l.source, l.target) for l in isl] == list(zip(sat_ids, sat_ids[1:]))
        # the planned failure targets a real ground link
        assert s.failure.link_id in {l.link_id for l in ground}
        assert s.failure.satellite_id in sat_ids
