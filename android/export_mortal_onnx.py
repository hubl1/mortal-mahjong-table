#!/usr/bin/env python3
"""Export the trained Mortal v4 policy to a fixed-batch Android ONNX model.

The Android runtime only needs inference.  Combining Brain and DQN into one
graph also keeps the Kotlin interface deliberately small: observation + legal
action mask in, Q values out.
"""

from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys

import numpy as np
import onnx
import onnxruntime as ort
import torch
from torch import nn


HERE = pathlib.Path(__file__).resolve().parent
TABLE_ROOT = HERE.parent
BOT_ROOT = TABLE_ROOT / "vendor" / "Akagi-MjaiBot-Mortal-main"
DEFAULT_CHECKPOINT = TABLE_ROOT / "models" / "mortal-full-data-best-240000.pth"
DEFAULT_OUTPUT = HERE / "model" / "mortal-v4-fp32.onnx"


class MortalPolicy(nn.Module):
    def __init__(self, brain: nn.Module, dqn: nn.Module):
        super().__init__()
        self.brain = brain
        self.dqn = dqn

    def forward(self, observation: torch.Tensor, legal_mask: torch.Tensor) -> torch.Tensor:
        return self.dqn(self.brain(observation), legal_mask)


def load_model_module():
    sys.path.insert(0, str(BOT_ROOT))
    spec = importlib.util.spec_from_file_location("mortal_android_model", BOT_ROOT / "model.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Mortal model.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def export(checkpoint: pathlib.Path, output: pathlib.Path) -> None:
    mortal_model = load_model_module()
    state = torch.load(checkpoint, map_location="cpu", weights_only=False)
    version = int(state["config"]["control"]["version"])
    if version != 4:
        raise ValueError(f"Android exporter currently expects Mortal v4, got v{version}")

    brain = mortal_model.Brain(
        version=version,
        conv_channels=int(state["config"]["resnet"]["conv_channels"]),
        num_blocks=int(state["config"]["resnet"]["num_blocks"]),
    ).eval()
    dqn = mortal_model.DQN(version=version).eval()
    brain.load_state_dict(state["mortal"])
    dqn.load_state_dict(state["current_dqn"])
    policy = MortalPolicy(brain, dqn).eval()

    obs_channels, tile_count = mortal_model.obs_shape(version)
    action_count = int(mortal_model.ACTION_SPACE)
    generator = torch.Generator().manual_seed(20261005)
    observation = torch.randn(1, obs_channels, tile_count, generator=generator)
    legal_mask = torch.zeros(1, action_count, dtype=torch.bool)
    legal_mask[:, [0, 3, 9, 17, 45]] = True

    output.parent.mkdir(parents=True, exist_ok=True)
    with torch.inference_mode():
        expected = policy(observation, legal_mask).cpu().numpy()

    torch.onnx.export(
        policy,
        (observation, legal_mask),
        output,
        input_names=["observation", "legal_mask"],
        output_names=["q_values"],
        opset_version=18,
        do_constant_folding=True,
        dynamo=False,
    )

    graph = onnx.load(output)
    onnx.checker.check_model(graph)
    session = ort.InferenceSession(str(output), providers=["CPUExecutionProvider"])
    actual = session.run(
        ["q_values"],
        {
            "observation": observation.numpy(),
            "legal_mask": legal_mask.numpy(),
        },
    )[0]
    finite = np.isfinite(expected) & np.isfinite(actual)
    max_error = float(np.max(np.abs(expected[finite] - actual[finite])))
    expected_action = int(np.argmax(expected[0]))
    actual_action = int(np.argmax(actual[0]))
    if expected_action != actual_action or max_error > 2e-4:
        raise RuntimeError(
            f"ONNX verification failed: action {expected_action}/{actual_action}, "
            f"max finite error {max_error:.8f}"
        )

    print(f"checkpoint={checkpoint}")
    print(f"output={output}")
    print(f"size_bytes={output.stat().st_size}")
    print(f"shape=1x{obs_channels}x{tile_count} -> 1x{action_count}")
    print(f"argmax={actual_action}")
    print(f"max_finite_error={max_error:.8f}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=pathlib.Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    export(args.checkpoint.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
