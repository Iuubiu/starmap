/**
 * 导入面板（票 67 验收④⑤）。
 *
 * ## 为什么导入在独立卡片里，导出却在每张关卡卡上
 *
 * 导出是「对某一关的动作」，它需要一个 levelId —— 放在关卡卡上，用户不需要
 * 先选一遍「导哪一关」。导入是「对整库的动作」，它不针对任何已有条目，
 * 单独一张卡才不会让人以为「要先选一关再导入」。
 *
 * ## 为什么不在这里做「导出→导入→导出」的往返校验
 *
 * 验收⑤要的是**两次下载内容除 `exportedAt` 外一致**。这个判据由后端保证
 * （`computeShareHash` 剥掉 `meta.id` 后算 sha256，导入时重编 id 但保留其余
 * 字段），前端能做的只有「把服务端给的东西原样写进文件」与「把用户选的文件
 * 原样发给服务端」。中间加一层规范化（比如排序键、去掉空字段）就会让
 * 往返结果与后端算出来的 hash 对不上，反而破坏幂等。所以这里**不做任何
 * 加工**，只在 JSON.parse 失败时给一句人话。
 */
import { useRef, useState } from 'react';
import {
  Badge,
  Body1,
  Button,
  Card,
  CardHeader,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { LevelExportFile, LevelImportResponse } from '../api/generated/model';
import { describeApiError } from './describe-error';
import { readLevelFile } from './download';

const useStyles = makeStyles({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  row: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  // 原生 file input 的默认宽度在窄屏会溢出，用一个可换行的容器兜住。
  fileInput: {
    maxWidth: '100%',
    minWidth: 0,
  },
  wrapText: {
    overflowWrap: 'anywhere',
  },
});

export interface TransferPanelProps {
  onImport: (file: LevelExportFile) => void;
  importPending: boolean;
  importError: unknown;
  importResult: LevelImportResponse | undefined;
}

export function TransferPanel({
  onImport,
  importPending,
  importError,
  importResult,
}: TransferPanelProps) {
  const styles = useStyles();
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    setLocalError(null);
    setPickedName(file?.name ?? null);
    if (!file) return;
    const parsed = await readLevelFile(file);
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    // 形状（400）与内容（422）都交给服务端判 —— 前端只保证「这是 JSON」。
    onImport(parsed.value as LevelExportFile);
  };

  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold">导入关卡文件</Text>}
        description={
          <Body1>
            选一个之前导出的 <code>.level.json</code> 文件，它会被复原成一张新关卡
            （不会覆盖你已有的关卡）。
          </Body1>
        }
      />

      <div className={styles.body}>
        <div className={styles.row}>
          <input
            ref={inputRef}
            className={styles.fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="选择关卡文件"
            onChange={(event) => {
              void onFile(event.target.files?.[0]);
              // 清掉 value，否则连续选同一个文件不会再触发 change。
              event.target.value = '';
            }}
          />
          <Button
            appearance="secondary"
            disabled={importPending}
            onClick={() => inputRef.current?.click()}
          >
            选择文件…
          </Button>
          {pickedName && (
            <Text size={200} className={styles.wrapText}>
              已选：{pickedName}
            </Text>
          )}
        </div>

        {localError && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>这个文件读不了</MessageBarTitle>
              {localError}
            </MessageBarBody>
          </MessageBar>
        )}

        {importError !== null && importError !== undefined && (
          <MessageBar intent="error">
            <MessageBarBody>
              <MessageBarTitle>导入被拒</MessageBarTitle>
              {describeApiError(importError)}
            </MessageBarBody>
          </MessageBar>
        )}

        {importResult && (
          <MessageBar intent="success">
            <MessageBarBody>
              <MessageBarTitle>
                {importResult.created ? '导入成功' : '这份文件之前导入过'}
              </MessageBarTitle>
              <div className={styles.row}>
                <Badge appearance="outline" className={styles.wrapText}>
                  {importResult.levelId}
                </Badge>
                <Text size={200}>{importResult.itemCount} 道题</Text>
                {!importResult.created && (
                  <Text size={200}>
                    （内容没变，所以复用了上次导入的那张关卡，不会重复堆一份）
                  </Text>
                )}
              </div>
            </MessageBarBody>
          </MessageBar>
        )}
      </div>
    </Card>
  );
}
