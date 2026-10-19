"""spec.md 术语统一：kc/kp 双缩写 -> micro_kp_id；门控三拼法 -> 检索门控/出口门控。"""
import io
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PATH = r"D:\DeepSeek\starmap\.scratch\starmap-core\spec.md"

src = io.open(PATH, encoding="utf-8").read()
orig = src
counts = {}


def sub(pattern, repl, label):
    global src
    new, n = re.subn(pattern, repl, src)
    counts[label] = n
    src = new


# --- 1. kc_id -> micro_kp_id ---------------------------------------------
sub(r"\bkc_id\b", "micro_kp_id", "kc_id -> micro_kp_id")
sub(r"\bkcId\b", "microKpId", "kcId -> microKpId")

# --- 2. 门控：消灭三种拼法，只留「检索门控」与「出口门控」 ----------------
# 先保护已经是正确写法的
sub(r"检索门控", "\x00SEARCH_GATE\x00", "protect 检索门控")
sub(r"出口门控", "\x00EXIT_GATE\x00", "protect 出口门控")
# RAG 门控 / RAG 检索门控 -> 检索门控
sub(r"RAG\s*检索门控", "检索门控", "RAG 检索门控 -> 检索门控")
sub(r"RAG\s*门控", "检索门控", "RAG 门控 -> 检索门控")
# 门控检索 -> 检索门控
sub(r"门控检索", "检索门控", "门控检索 -> 检索门控")
# 裸「门控」在明确指检索的上下文里 -> 检索门控
sub(r"D6\s*门控", "D6 检索门控", "D6 门控 -> D6 检索门控")
# 还原保护
src = src.replace("\x00SEARCH_GATE\x00", "检索门控")
src = src.replace("\x00EXIT_GATE\x00", "出口门控")

# --- 3. 卡 -> 内容卡/产物卡/关卡卡 ---------------------------------------
# cards[] 的说明文字
sub(r"关卡文件内的讲解片段", "关卡文件内的讲解片段（内容卡）", "cards[] 注释")
# 产物卡位置
sub(r"每轮产出结构化卡片", "每轮产出产物卡", "结构化卡片 -> 产物卡")
sub(r"屏幕中央产出结构化卡片", "屏幕中央产出产物卡", "结构化卡片 -> 产物卡 (2)")

# --- 4. 同一实体三个名字 -> 复验 ------------------------------------------
sub(r"掌握挑战", "复验", "掌握挑战 -> 复验")
sub(r"被抽考", "被复验抽到", "被抽考 -> 被复验抽到")

# --- 5. 水平画像 -> 水平档 ------------------------------------------------
sub(r"水平画像", "水平档", "水平画像 -> 水平档")

# --- 6. 判级 -> 定级 ------------------------------------------------------
sub(r"判级", "定级", "判级 -> 定级")

# --- 7. 回合/轮 的阈值处消歧 ---------------------------------------------
sub(
    r"连续 3 次答不上",
    "同一追问轮序列内连续 3 轮答不上",
    "追问轮阈值消歧",
)

# --- 8. 「≥2 道同结构变式」与术语表「平行题不是变式」的矛盾 ---------------
sub(
    r"≥2 道同结构变式（间隔 ≥1 天）",
    "≥2 道平行题（间隔 ≥1 天，不增加变式数）",
    "同结构变式 -> 平行题",
)

io.open(PATH, "w", encoding="utf-8", newline="\n").write(src)

print("字符数 %d -> %d" % (len(orig), len(src)))
for k, v in counts.items():
    print("  %-34s %d" % (k, v))
print()
print("=== 残留检查 ===")
for pat in [r"\bkc_id\b", r"\bkcId\b", r"RAG\s*门控", r"门控检索", r"掌握挑战",
            r"水平画像", r"判级", r"同结构变式"]:
    hits = len(re.findall(pat, src))
    print("  %-20s %s" % (pat, "OK 已清零" if hits == 0 else "残留 %d 处" % hits))
