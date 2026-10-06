use std::panic::{AssertUnwindSafe, catch_unwind};

use anyhow::{Context, Result, bail, ensure};
use jni::JNIEnv;
use jni::objects::{JClass, JFloatArray, JString};
use jni::sys::{JNI_FALSE, JNI_TRUE, jboolean, jfloatArray, jlong, jstring};
use riichi::consts::{ACTION_SPACE, MAX_VERSION};
use riichi::mjai::{Event, EventExt, EventWithCanAct, Metadata};
use riichi::state::{ActionCandidate, PlayerState};
use riichi::{must_tile, tu8};

const MODEL_VERSION: u32 = 4;
const OBS_SIZE: usize = 1012 * 34;

#[derive(Default)]
struct EncodedScene {
    observation: Vec<f32>,
    mask_bits: u64,
}

struct AndroidBot {
    player_id: u8,
    state: PlayerState,
    normal: Option<EncodedScene>,
    kan: Option<EncodedScene>,
}

impl AndroidBot {
    fn new(player_id: u8) -> Result<Self> {
        ensure!(player_id < 4, "player id must be in 0..=3");
        ensure!(MODEL_VERSION <= MAX_VERSION, "unsupported Mortal observation version");
        riichi::algo::shanten::ensure_init();
        riichi::algo::agari::ensure_init();
        Ok(Self {
            player_id,
            state: PlayerState::new(player_id),
            normal: None,
            kan: None,
        })
    }

    fn update(&mut self, json: &str, can_act: bool) -> Result<bool> {
        let data: EventWithCanAct = serde_json::from_str(json)
            .with_context(|| format!("invalid mjai event: {json}"))?;
        let cans = self.state.update(&data.event)?;
        self.normal = None;
        self.kan = None;
        if !can_act || matches!(data.can_act, Some(false)) || !cans.can_act() {
            return Ok(false);
        }

        self.normal = Some(encode_scene(&self.state, false));
        let need_kan_select = (cans.can_ankan || cans.can_kakan)
            && self.state.ankan_candidates().len() + self.state.kakan_candidates().len() > 1;
        if need_kan_select {
            self.kan = Some(encode_scene(&self.state, true));
        }
        Ok(true)
    }

    fn scene(&self, kan_select: bool) -> Result<&EncodedScene> {
        let scene = if kan_select { &self.kan } else { &self.normal };
        scene.as_ref().context("no encoded decision is pending")
    }

    fn reaction(&self, mut q_values: [f32; ACTION_SPACE], kan_q: Option<[f32; ACTION_SPACE]>) -> Result<String> {
        let cans = self.state.last_cans();
        let mut action = argmax(&q_values);
        if action == 43 && !self.state.rule_based_agari() {
            q_values[43] = f32::NEG_INFINITY;
            action = argmax(&q_values);
        }
        let kan_action = kan_q.as_ref().map(argmax);
        let event = action_to_event(self.player_id, &self.state, cans, action, kan_action)?;
        let meta = Metadata {
            q_values: Some(compact_q_values(&q_values, self.scene(false)?.mask_bits)),
            mask_bits: Some(self.scene(false)?.mask_bits),
            is_greedy: Some(true),
            shanten: Some(self.state.shanten()),
            at_furiten: Some(self.state.at_furiten()),
            kan_select: kan_q.map(|q| {
                let mask_bits = self.kan.as_ref().map_or(0, |v| v.mask_bits);
                Box::new(Metadata {
                    q_values: Some(compact_q_values(&q, mask_bits)),
                    mask_bits: Some(mask_bits),
                    is_greedy: Some(true),
                    ..Default::default()
                })
            }),
            ..Default::default()
        };
        Ok(serde_json::to_string(&EventExt { event, meta: Some(meta) })?)
    }
}

fn encode_scene(state: &PlayerState, kan_select: bool) -> EncodedScene {
    let (observation, mask) = state.encode_obs(MODEL_VERSION, kan_select);
    let (observation, offset) = observation.into_raw_vec_and_offset();
    debug_assert!(matches!(offset, None | Some(0)));
    debug_assert_eq!(observation.len(), OBS_SIZE);
    let mask_bits = mask
        .iter()
        .enumerate()
        .fold(0_u64, |bits, (index, &enabled)| {
            if enabled { bits | (1_u64 << index) } else { bits }
        });
    EncodedScene { observation, mask_bits }
}

fn compact_q_values(values: &[f32; ACTION_SPACE], mask_bits: u64) -> Vec<f32> {
    values
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(index, value)| ((mask_bits >> index) & 1 == 1).then_some(value))
        .collect()
}

fn argmax(values: &[f32; ACTION_SPACE]) -> usize {
    values
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| left.total_cmp(right))
        .map_or(ACTION_SPACE - 1, |(index, _)| index)
}

fn action_to_event(
    actor: u8,
    state: &PlayerState,
    cans: ActionCandidate,
    action: usize,
    kan_action: Option<usize>,
) -> Result<Event> {
    let akas_in_hand = state.akas_in_hand();
    Ok(match action {
        0..=36 => {
            ensure!(cans.can_discard, "Mortal selected discard when discard is unavailable");
            let pai = must_tile!(action);
            Event::Dahai {
                actor,
                pai,
                tsumogiri: state.last_self_tsumo().is_some_and(|tile| tile == pai),
            }
        }
        37 => {
            ensure!(cans.can_riichi, "Mortal selected riichi when riichi is unavailable");
            Event::Reach { actor }
        }
        38 => {
            ensure!(cans.can_chi_low, "Mortal selected unavailable low chi");
            let pai = state.last_kawa_tile().context("chi without last discard")?;
            let first = pai.next();
            let aka = match pai.as_u8() {
                tu8!(3m) | tu8!(4m) => akas_in_hand[0],
                tu8!(3p) | tu8!(4p) => akas_in_hand[1],
                tu8!(3s) | tu8!(4s) => akas_in_hand[2],
                _ => false,
            };
            let consumed = if aka {
                [first.akaize(), first.next().akaize()]
            } else {
                [first, first.next()]
            };
            Event::Chi { actor, target: cans.target_actor, pai, consumed }
        }
        39 => {
            ensure!(cans.can_chi_mid, "Mortal selected unavailable middle chi");
            let pai = state.last_kawa_tile().context("chi without last discard")?;
            let aka = match pai.as_u8() {
                tu8!(4m) | tu8!(6m) => akas_in_hand[0],
                tu8!(4p) | tu8!(6p) => akas_in_hand[1],
                tu8!(4s) | tu8!(6s) => akas_in_hand[2],
                _ => false,
            };
            let consumed = if aka {
                [pai.prev().akaize(), pai.next().akaize()]
            } else {
                [pai.prev(), pai.next()]
            };
            Event::Chi { actor, target: cans.target_actor, pai, consumed }
        }
        40 => {
            ensure!(cans.can_chi_high, "Mortal selected unavailable high chi");
            let pai = state.last_kawa_tile().context("chi without last discard")?;
            let last = pai.prev();
            let aka = match pai.as_u8() {
                tu8!(6m) | tu8!(7m) => akas_in_hand[0],
                tu8!(6p) | tu8!(7p) => akas_in_hand[1],
                tu8!(6s) | tu8!(7s) => akas_in_hand[2],
                _ => false,
            };
            let consumed = if aka {
                [last.prev().akaize(), last.akaize()]
            } else {
                [last.prev(), last]
            };
            Event::Chi { actor, target: cans.target_actor, pai, consumed }
        }
        41 => {
            ensure!(cans.can_pon, "Mortal selected unavailable pon");
            let pai = state.last_kawa_tile().context("pon without last discard")?;
            let aka = match pai.as_u8() {
                tu8!(5m) => akas_in_hand[0],
                tu8!(5p) => akas_in_hand[1],
                tu8!(5s) => akas_in_hand[2],
                _ => false,
            };
            let consumed = if aka { [pai.akaize(), pai.deaka()] } else { [pai.deaka(); 2] };
            Event::Pon { actor, target: cans.target_actor, pai, consumed }
        }
        42 => {
            ensure!(cans.can_daiminkan || cans.can_ankan || cans.can_kakan, "Mortal selected unavailable kan");
            let ankan = state.ankan_candidates();
            let kakan = state.kakan_candidates();
            let tile = if let Some(index) = kan_action {
                ensure!(index <= 36, "invalid kan tile action {index}");
                let tile = must_tile!(index);
                ensure!(ankan.contains(&tile) || kakan.contains(&tile), "kan tile is not a candidate");
                tile
            } else if cans.can_daiminkan {
                state.last_kawa_tile().context("daiminkan without last discard")?
            } else if cans.can_ankan {
                *ankan.first().context("ankan without candidate")?
            } else {
                *kakan.first().context("kakan without candidate")?
            };
            if cans.can_daiminkan {
                let consumed = if tile.is_aka() { [tile.deaka(); 3] } else { [tile.akaize(), tile, tile] };
                Event::Daiminkan { actor, target: cans.target_actor, pai: tile, consumed }
            } else if cans.can_ankan && ankan.contains(&tile.deaka()) {
                Event::Ankan { actor, consumed: [tile.akaize(), tile, tile, tile] }
            } else {
                let aka = match tile.as_u8() {
                    tu8!(5m) => akas_in_hand[0],
                    tu8!(5p) => akas_in_hand[1],
                    tu8!(5s) => akas_in_hand[2],
                    _ => false,
                };
                let (pai, consumed) = if aka {
                    (tile.akaize(), [tile.deaka(); 3])
                } else {
                    (tile.deaka(), [tile.akaize(), tile.deaka(), tile.deaka()])
                };
                Event::Kakan { actor, pai, consumed }
            }
        }
        43 => {
            ensure!(cans.can_agari(), "Mortal selected unavailable win");
            Event::Hora { actor, target: cans.target_actor, deltas: None, ura_markers: None }
        }
        44 => {
            ensure!(cans.can_ryukyoku, "Mortal selected unavailable abortive draw");
            Event::Ryukyoku { deltas: None }
        }
        45 => Event::None,
        _ => bail!("invalid Mortal action {action}"),
    })
}

fn bot_mut<'a>(handle: jlong) -> Result<&'a mut AndroidBot> {
    ensure!(handle != 0, "native bot is closed");
    // SAFETY: handles are created from Box::into_raw below, are owned by the
    // matching Kotlin NativeMortal instance, and are destroyed exactly once.
    Ok(unsafe { &mut *(handle as *mut AndroidBot) })
}

fn throw(env: &mut JNIEnv<'_>, error: impl std::fmt::Display) {
    let _ = env.throw_new("java/lang/IllegalStateException", error.to_string());
}

fn ffi<T>(
    env: &mut JNIEnv<'_>,
    default: T,
    body: impl FnOnce(&mut JNIEnv<'_>) -> Result<T>,
) -> T {
    match catch_unwind(AssertUnwindSafe(|| body(env))) {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            throw(env, format!("{error:#}"));
            default
        }
        Err(_) => {
            throw(env, "panic in Mortal native engine");
            default
        }
    }
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hubl_mortalmahjong_engine_NativeMortal_nativeCreate(
    mut env: JNIEnv,
    _class: JClass,
    player_id: jlong,
) -> jlong {
    ffi(&mut env, 0, |_| {
        let bot = Box::new(AndroidBot::new(u8::try_from(player_id)?)?);
        Ok(Box::into_raw(bot) as jlong)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hubl_mortalmahjong_engine_NativeMortal_nativeDestroy(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) {
    ffi(&mut env, (), |_| {
        ensure!(handle != 0, "native bot is already closed");
        // SAFETY: see bot_mut. Reconstructing the box drops this handle once.
        unsafe { drop(Box::from_raw(handle as *mut AndroidBot)) };
        Ok(())
    });
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hubl_mortalmahjong_engine_NativeMortal_nativeUpdate(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    event_json: JString,
    can_act: jboolean,
) -> jboolean {
    let json = match env.get_string(&event_json) {
        Ok(value) => value.to_string_lossy().into_owned(),
        Err(error) => {
            throw(&mut env, error);
            return JNI_FALSE;
        }
    };
    ffi(&mut env, JNI_FALSE, |_| {
        Ok(if bot_mut(handle)?.update(&json, can_act == JNI_TRUE)? { JNI_TRUE } else { JNI_FALSE })
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hubl_mortalmahjong_engine_NativeMortal_nativeObservation(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    kan_select: jboolean,
) -> jfloatArray {
    ffi(&mut env, std::ptr::null_mut(), |env| {
        let values = &bot_mut(handle)?.scene(kan_select == JNI_TRUE)?.observation;
        let array = env.new_float_array(i32::try_from(values.len())?)?;
        env.set_float_array_region(&array, 0, values)?;
        Ok(array.into_raw())
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hubl_mortalmahjong_engine_NativeMortal_nativeMask(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    kan_select: jboolean,
) -> jlong {
    ffi(&mut env, 0, |_| {
        Ok(bot_mut(handle)?.scene(kan_select == JNI_TRUE)?.mask_bits as jlong)
    })
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hubl_mortalmahjong_engine_NativeMortal_nativeNeedsKanSelection(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
) -> jboolean {
    ffi(&mut env, JNI_FALSE, |_| {
        Ok(if bot_mut(handle)?.kan.is_some() { JNI_TRUE } else { JNI_FALSE })
    })
}

fn read_q_values(env: &mut JNIEnv<'_>, array: &JFloatArray<'_>) -> Result<[f32; ACTION_SPACE]> {
    ensure!(env.get_array_length(array)? == ACTION_SPACE as i32, "expected {ACTION_SPACE} Q values");
    let mut values = [0_f32; ACTION_SPACE];
    env.get_float_array_region(array, 0, &mut values)?;
    Ok(values)
}

#[unsafe(no_mangle)]
pub extern "system" fn Java_com_hubl_mortalmahjong_engine_NativeMortal_nativeReaction(
    mut env: JNIEnv,
    _class: JClass,
    handle: jlong,
    q_values: JFloatArray,
    kan_q_values: JFloatArray,
) -> jstring {
    ffi(&mut env, std::ptr::null_mut(), |env| {
        let normal = read_q_values(env, &q_values)?;
        let kan = if env.get_array_length(&kan_q_values)? == 0 {
            None
        } else {
            Some(read_q_values(env, &kan_q_values)?)
        };
        let json = bot_mut(handle)?.reaction(normal, kan)?;
        Ok(env.new_string(json)?.into_raw())
    })
}
