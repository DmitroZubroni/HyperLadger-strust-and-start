import { Container, Row, Col, Card, Alert, Button, Table } from "react-bootstrap";
import Header from "../component/Header.jsx";
import { AtlantContext } from "../../core/context.jsx";
import { useContext, useEffect, useState } from "react";
import Authorization from "../component/Authorization.jsx";

const UserInfo = () => {
    const { user, isBank, get, post } = useContext(AtlantContext);
    const [data, setData] = useState(null);
    const [error, setError] = useState("");

    // Личный кабинет банка или водителя: данные читаются из контракта.
    // forUser — для кого загружены данные, чтобы после смены пользователя не показать чужие
    const load = async () => {
        try {
            let result;
            if (isBank) {
                result = await get("GetBankAccount");
            } else {
                result = await get("GetMyProfile");
            }
            setData({ ...result, forUser: user });
            setError("");
        } catch (e) {
            setData(null);
            setError(e.message);
        }
    };

    useEffect(() => {
        if (!user) return;
        load();
    }, [user]);

    const ready = data && data.forUser === user;

    const payFine = async (fineId) => {
        await post("PayFine", [fineId]);
        load();
    };

    return (
        <div>
            <Header />
            {!user ? (
                <Authorization />
            ) : (
                <Container>
                    <h2 className="container">Личный кабинет</h2>
                    <Button onClick={load}>обновить</Button>
                    <hr />

                    {error && <Alert variant="warning">{error}. Водитель регистрируется на странице «функции».</Alert>}

                    {ready && isBank && (
                        <Card className="container">
                            <Card.Body>
                                <Card.Title>Счёт банка: {data.balance} ProfiCoin</Card.Title>
                                <Table>
                                    <thead>
                                        <tr><th>Время</th><th>Плательщик</th><th>Сумма</th></tr>
                                    </thead>
                                    <tbody>
                                        {data.payments.map((payment, index) => (
                                            <tr key={index}>
                                                <td>{new Date(payment.at).toLocaleString()}</td>
                                                <td>{payment.from}</td>
                                                <td>{payment.amount} ProfiCoin</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </Card.Body>
                        </Card>
                    )}

                    {ready && !isBank && (
                        <Row>
                            <Col>
                                <Card className="container">
                                    <Card.Body>
                                        <Card.Title>{data.fullName}</Card.Title>
                                        <p>Роль: {data.isDps ? "сотрудник ДПС и водитель" : "водитель"}</p>
                                        <p>Баланс: {data.balance} ProfiCoin</p>
                                        <p>Стаж: {data.experienceYears} лет (с {data.experienceStartYear})</p>
                                        <p>Неоплаченные штрафы: {data.unpaidFines}</p>
                                        <p>Удостоверение: {data.license
                                            ? `№ ${data.license.number}, категория ${data.license.category}, до ${data.license.expiresAt}`
                                            : "нет"}</p>
                                        <p>Транспортные средства: {data.vehicles.length === 0 ? "нет" : data.vehicles
                                            .map((v) => `категория ${v.category}, ${v.marketValue} ProfiCoin, ${v.serviceLife} лет`)
                                            .join("; ")}</p>
                                    </Card.Body>
                                </Card>
                            </Col>
                            <Col>
                                <Card className="container">
                                    <Card.Body>
                                        <Card.Title>Штрафы</Card.Title>
                                        {data.fines.length === 0 && <p>Штрафов нет</p>}
                                        {data.fines.map((fine) => (
                                            <div key={fine.id}>
                                                <p>ID: {fine.id}</p>
                                                <p>Выписан: {new Date(fine.issuedAt).toLocaleString()}</p>
                                                {fine.paidAt
                                                    ? <p>Оплачен: {fine.paidAmount} ProfiCoin</p>
                                                    : <Button onClick={() => payFine(fine.id)}>оплатить {fine.currentAmount} ProfiCoin</Button>}
                                                <hr />
                                            </div>
                                        ))}
                                    </Card.Body>
                                </Card>
                                <Card className="container">
                                    <Card.Body>
                                        <Card.Title>Сообщения</Card.Title>
                                        {data.messages.length === 0 && <p>Сообщений нет</p>}
                                        {data.messages.slice().reverse().map((message, index) => (
                                            <Alert key={index} variant={message.type === "error" ? "danger" : "success"}>
                                                {new Date(message.at).toLocaleString()}: {message.text}
                                            </Alert>
                                        ))}
                                    </Card.Body>
                                </Card>
                            </Col>
                        </Row>
                    )}
                </Container>
            )}
        </div>
    );
};

export default UserInfo;
