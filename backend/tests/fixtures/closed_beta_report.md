# RC Circuit Transient Response / RC 電路暫態響應

## 實驗目的

本實驗量測 RC 串聯電路在方波輸入下的充放電響應，並比較理論時間常數與示波器實測值。The experiment compares the theoretical time constant with the measured oscilloscope response.

## 實驗原理

電容充電電壓為：

$$V_C(t)=V_0\left(1-e^{-t/RC}\right)$$

本次使用 $R=10.0\,\mathrm{k\Omega}$、$C=100\,\mathrm{nF}$，理論時間常數為 $\tau=RC=1.00\,\mathrm{ms}$。

## 實驗步驟

1. 使用 10.0 kΩ 電阻與 100 nF 電容建立串聯電路。
2. 将函数发生器设为 5.00 Vpp、100 Hz 方波。
3. 以示波器记录电容两端电压，并重复量测 5 次。
4. 由达到最终值 63.2% 的时间估算时间常数。

## 原始数据

表 1：RC 时间常数量测结果

| 次数 | 电阻 R (kΩ) | 电容 C (nF) | 实测 τ (ms) | 环境温度 (°C) |
|---:|---:|---:|---:|---:|
| 1 | 10.0 | 100 | 0.98 | 24.1 |
| 2 | 10.0 | 100 | 1.01 | 24.1 |
| 3 | 10.0 | 100 | 1.00 | 24.2 |
| 4 | 10.0 | 100 | 1.03 | 24.2 |
| 5 | 10.0 | 100 | 0.99 | 24.2 |

![图 1：AutoLabReport 测试图像](../frontend/public/brand/autolabreport-logo.png)

如图 1 所示，本测试同时检查图片是否能在导出文件中保持比例且不越过页边距。

## 实验流程图

```mermaid
flowchart LR
  A[建立 RC 电路] --> B[输入方波]
  B --> C[量测电容电压]
  C --> D[估算时间常数]
  D --> E[比较理论与实测]
```

## 数据处理程式

```python
measurements_ms = [0.98, 1.01, 1.00, 1.03, 0.99]
mean_ms = sum(measurements_ms) / len(measurements_ms)
deviations = [value - mean_ms for value in measurements_ms]
print({"mean_ms": mean_ms, "deviations": deviations, "note": "This deliberately long line checks whether code wraps or remains readable without clipping at the right page margin."})
```

Closed Beta 安全模式只将 Python 区块当作代码显示，不会在持有生产密钥的 API 进程中执行。

## 结果与误差分析

五次实测平均时间常数为 1.002 ms，与理论值 1.00 ms 的相对差约为 0.20%。主要不确定度来自电阻与电容容差、示波器游标解析度，以及触发点选择。量测结果没有支持“零误差”或“百分之百准确”等绝对结论。

第一项限制是元件标称值并不等于实际值。即使电阻标示 10.0 kΩ、电容标示 100 nF，制造容差仍会影响理论时间常数。第二项限制是示波器取样和游标读值会引入人为判断差异。第三项限制是面包板寄生电容及探棒负载可能轻微改变响应曲线。

在重复量测中，0.98 ms 至 1.03 ms 的范围没有明显单调漂移。各次结果围绕 1.00 ms 分布，表示接线与触发条件大致稳定。若要进一步降低不确定度，应使用 LCR meter 先量测实际电容，并保存示波器 CSV 以进行自动拟合。

For the English-language check, the measured values remain close to the theoretical prediction. The report intentionally mixes Chinese and English to verify font fallback, paragraph spacing, and line wrapping in both DOCX and PDF output.

## 延伸讨论

当输入频率提高时，电容可能来不及完成充放电，输出波形会逐渐接近三角形。若输入频率降低，则每一周期有更多时间接近稳态值。这个现象可由指数响应与周期的比例解释，但不能只凭一张截图推断所有频率下的行为。

误差传播还应考虑 $\tau=RC$ 中两个量的相对不确定度。若 $R$ 与 $C$ 独立，则可以使用平方和开根号估算组合相对不确定度。正式提交前应把元件 datasheet 的容差列入计算，并说明仪器校正日期。

本段用于多页分页测试。报告在分页时应避免将标题留在页尾、将图说与图片拆开，或让表格边框超出页面。较长段落仍应保有清楚行距，不出现中文字形方框、重叠或裁切。

## 结论

本实验量得平均时间常数 1.002 ms，与理论值 1.00 ms 相近，相对差约为 0.20%。结果支持 RC 指数响应模型在本次元件与频率条件下适用，但结论仍受元件容差、示波器解析度与接线寄生效应限制。

## 参考资料

[1] Horowitz, P. and Hill, W., *The Art of Electronics*, Cambridge University Press.

[2] https://en.wikipedia.org/wiki/RC_circuit
