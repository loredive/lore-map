import numpy as np

from layouts import align_to, cohesion


def test_align_undoes_rotation_reflection_and_scale():
    rng = np.random.default_rng(0)
    ref = rng.normal(size=(50, 2))
    theta = 1.1
    rot = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
    flipped = (ref @ rot) * [[-3.0, 3.0]] + [5.0, -2.0]   # rotation, miroir, échelle, décalage
    np.testing.assert_allclose(align_to(flipped, ref), ref, atol=1e-9)


def test_cohesion_is_high_for_a_compact_group_and_low_for_a_scattered_one():
    # groupe 0 : un amas serré ; groupe 1 : ses points éparpillés entre ceux du groupe 2
    compact = np.c_[np.linspace(0, 0.1, 10), np.zeros(10)] + [10, 10]
    mixed = np.c_[np.arange(20.0), np.zeros(20)]
    xy = np.vstack([compact, mixed])
    labels = np.array([0] * 10 + [1, 2] * 10)
    c = cohesion(xy, labels, k=4)
    assert c[0] == 1.0
    assert c[1] < 0.5
