"""A student's model choice must reach the model, and 自動 must pick one that exists.

Before this, the settings list was fixed names (several accepted by no provider),
built-in AI ignored the choice, and the defaults for Gemini and DeepSeek keys were
models their providers no longer served -- so 自動 failed on every call for both, with
an error telling the student to "retry later".
"""

from __future__ import annotations

import os
import unittest
import urllib.error
from unittest.mock import patch

import main

KEY = "sk-test-not-a-real-key"


def _clear_model_cache() -> None:
    main._model_list_cache.clear()


class OwnKeyModelResolutionTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_model_cache()

    def test_an_explicit_choice_is_used(self):
        self.assertEqual(main._resolve_own_key_model("openai", KEY, "gpt-4o-mini"), "gpt-4o-mini")

    def test_a_malformed_choice_is_refused_before_any_provider_sees_it(self):
        for bad in ("../../v1/files", "gemini-2.5-flash?key=x", "a b", "", "-leading-dash"):
            with self.subTest(model=bad):
                if bad == "":
                    continue  # empty means 自動, covered below
                with self.assertRaises(main.HTTPException) as raised:
                    main._resolve_own_key_model("gemini", KEY, bad)
                self.assertEqual(raised.exception.status_code, 400)

    def test_auto_takes_the_first_preference_the_key_can_use(self):
        available = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3.5-flash"]
        with patch.object(main, "_fetch_provider_models", return_value=available):
            self.assertEqual(main._resolve_own_key_model("gemini", KEY, None), "gemini-2.5-flash")

    def test_auto_prefers_a_cheap_model_when_no_preference_is_available(self):
        # Providers can list their most expensive model first.
        with patch.object(main, "_fetch_provider_models", return_value=["gpt-6-astra", "gpt-7-mini"]):
            self.assertEqual(main._resolve_own_key_model("openai", KEY, None), "gpt-7-mini")

    def test_auto_still_answers_when_the_provider_cannot_be_asked(self):
        with patch.object(main, "_fetch_provider_models", side_effect=urllib.error.URLError("down")):
            self.assertEqual(
                main._resolve_own_key_model("deepseek", KEY, None),
                main.OWN_KEY_MODEL_PREFERENCES["deepseek"][0],
            )

    # The regression itself: these were the defaults, and their providers had retired them.
    def test_auto_never_falls_back_to_a_retired_default(self):
        retired = {"gemini-1.5-flash", "gemini-2.0-flash", "claude-3-5-haiku-latest"}
        for provider, preferences in main.OWN_KEY_MODEL_PREFERENCES.items():
            with self.subTest(provider=provider):
                self.assertNotIn(preferences[0], retired)
        self.assertNotEqual(main.OWN_KEY_MODEL_PREFERENCES["deepseek"][0], "deepseek-chat")

    def test_a_provider_the_app_does_not_support_is_refused(self):
        with self.assertRaises(main.HTTPException):
            main._resolve_own_key_model("mystery-ai", KEY, None)


class ProviderModelListTests(unittest.TestCase):
    def setUp(self) -> None:
        _clear_model_cache()

    def test_openai_keeps_chat_models_and_drops_the_rest(self):
        payload = {"data": [{"id": model} for model in (
            "gpt-5.6-luna", "text-embedding-3-large", "gpt-image-2.5-flare",
            "gpt-realtime-2", "tts-1", "gpt-4o-mini", "whisper-1", "gpt-transcribe",
        )]}
        with patch.object(main, "_get_json", return_value=payload):
            self.assertEqual(main._fetch_provider_models("openai", KEY), ["gpt-5.6-luna", "gpt-4o-mini"])

    def test_gemini_is_asked_with_the_key_in_a_header_and_lists_generating_models(self):
        payload = {"models": [
            {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent", "countTokens"]},
            {"name": "models/text-embedding-004", "supportedGenerationMethods": ["embedContent"]},
            {"name": "models/gemini-2.5-pro", "supportedGenerationMethods": ["generateContent"]},
        ]}
        with patch.object(main, "_get_json", return_value=payload) as get_json:
            models = main._fetch_provider_models("gemini", KEY)
        self.assertEqual(models, ["gemini-2.5-flash", "gemini-2.5-pro"])
        url, headers = get_json.call_args.args[:2]
        self.assertNotIn(KEY, url)
        self.assertEqual(headers["x-goog-api-key"], KEY)

    def test_the_list_is_cached_and_a_failure_is_not(self):
        with patch.object(main, "_fetch_provider_models", side_effect=[urllib.error.URLError("x"), ["a-mini"], ["b"]]) as fetch:
            self.assertIsNone(main._provider_models("openai", KEY))
            self.assertEqual(main._provider_models("openai", KEY), ["a-mini"])
            self.assertEqual(main._provider_models("openai", KEY), ["a-mini"])
        self.assertEqual(fetch.call_count, 2)


class BuiltInChoiceTests(unittest.TestCase):
    def test_a_configured_choice_is_tried_first_and_the_rest_keep_their_order(self):
        with patch.object(main, "groq_client", object()), patch.object(main, "gemini_client", object()), \
                patch.object(main, "GROQ_MODELS", ["llama-a", "llama-b"]), \
                patch.object(main, "GEMINI_MODELS", ["gemini-x"]):
            self.assertEqual(
                main._builtin_attempts("gemini-x"),
                [("gemini", "gemini-x"), ("groq", "llama-a"), ("groq", "llama-b")],
            )

    # Saved settings from the old list must keep working, as they did when ignored.
    def test_a_name_from_the_old_list_is_ignored_not_refused(self):
        with patch.object(main, "groq_client", object()), patch.object(main, "gemini_client", None), \
                patch.object(main, "GROQ_MODELS", ["llama-a", "llama-b"]):
            for legacy in ("gpt-4.1", "gemini-flash", "user-api-model"):
                with self.subTest(model=legacy):
                    self.assertEqual(main._builtin_attempts(legacy), [("groq", "llama-a"), ("groq", "llama-b")])

    def test_the_engine_answers_with_the_chosen_model(self):
        calls = []

        def fake_chat(client, prompt, model):
            calls.append(model)
            return "答案"

        with patch.object(main, "groq_client", object()), patch.object(main, "gemini_client", None), \
                patch.object(main, "GROQ_MODELS", ["llama-a", "llama-b"]), \
                patch.object(main, "_run_openai_client_chat", side_effect=fake_chat):
            text, model = main._run_builtin_dual_engine("prompt", "llama-b")
        self.assertEqual((text, model, calls), ("答案", "groq:llama-b", ["llama-b"]))

    def test_the_built_in_gemini_fallback_is_not_a_shut_down_model(self):
        if os.getenv("GEMINI_MODEL") or os.getenv("GEMINI_MODELS") or os.getenv("GEMINI_FALLBACK_MODELS"):
            self.skipTest("configured by the environment")
        self.assertNotIn("gemini-2.0-flash", main.GEMINI_MODELS)
        self.assertNotIn("gemini-1.5-flash", main.GEMINI_MODELS)


class UpstreamRejectionTests(unittest.TestCase):
    # "Please retry later" was the answer to everything, including a model that no
    # longer exists, where retrying can never work.
    def test_a_missing_model_names_it_and_says_to_choose_another(self):
        for status in (400, 404):
            message = main._describe_upstream_rejection(status, "gemini-1.5-flash")
            self.assertIn("gemini-1.5-flash", message)
            self.assertIn("重新選擇模型", message)

    def test_a_refused_key_says_to_save_it_again(self):
        self.assertIn("API Key", main._describe_upstream_rejection(401, "x"))

    def test_a_rate_limit_is_named(self):
        self.assertIn("429", main._describe_upstream_rejection(429, "x"))

    def test_gemini_calls_carry_the_key_in_a_header_not_the_url(self):
        with patch.object(main, "_post_json", return_value={"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}) as post:
            main._run_gemini(KEY, "prompt", "gemini-2.5-flash")
        url, headers = post.call_args.args[:2]
        self.assertNotIn(KEY, url)
        self.assertEqual(headers["x-goog-api-key"], KEY)
        self.assertEqual(post.call_args.kwargs["model"], "gemini-2.5-flash")


class ModelsEndpointTests(unittest.TestCase):
    USER = {"id": "11111111-1111-4111-8111-111111111111", "email": "student@example.com"}

    def setUp(self) -> None:
        _clear_model_cache()

    def test_it_needs_an_account(self):
        with patch.object(main, "_get_user_from_authorization", return_value=None):
            with self.assertRaises(main.HTTPException) as raised:
                main.list_ai_models(authorization=None)
        self.assertEqual(raised.exception.status_code, 401)

    def test_it_lists_built_in_models_and_what_the_saved_key_can_use(self):
        with patch.object(main, "_get_user_from_authorization", return_value=self.USER), \
                patch.object(main, "groq_client", object()), patch.object(main, "gemini_client", None), \
                patch.object(main, "GROQ_MODELS", ["llama-a"]), \
                patch.object(main, "_get_decrypted_user_api_key", return_value=(KEY, "gemini")), \
                patch.object(main, "_fetch_provider_models", return_value=["gemini-2.5-flash", "gemini-2.5-pro"]):
            response = main.list_ai_models(authorization="Bearer t")

        self.assertEqual([option.id for option in response.built_in], ["llama-a"])
        self.assertEqual(response.own_key_provider, "gemini")
        self.assertTrue(response.own_key_live)
        self.assertEqual([option.id for option in response.own_key_models], ["gemini-2.5-flash", "gemini-2.5-pro"])
        self.assertEqual(response.own_key_default, "gemini-2.5-flash")

    def test_it_says_when_the_list_is_a_guess_because_the_provider_could_not_be_asked(self):
        with patch.object(main, "_get_user_from_authorization", return_value=self.USER), \
                patch.object(main, "_get_decrypted_user_api_key", return_value=(KEY, "anthropic")), \
                patch.object(main, "_fetch_provider_models", side_effect=urllib.error.URLError("down")):
            response = main.list_ai_models(authorization="Bearer t")
        self.assertFalse(response.own_key_live)
        self.assertEqual(
            [option.id for option in response.own_key_models],
            list(main.OWN_KEY_MODEL_PREFERENCES["anthropic"]),
        )

    def test_without_a_saved_key_only_built_in_models_are_offered(self):
        with patch.object(main, "_get_user_from_authorization", return_value=self.USER), \
                patch.object(main, "_get_decrypted_user_api_key", side_effect=main.HTTPException(status_code=400, detail="no key")):
            response = main.list_ai_models(authorization="Bearer t")
        self.assertIsNone(response.own_key_provider)
        self.assertEqual(response.own_key_models, [])


if __name__ == "__main__":
    unittest.main()
