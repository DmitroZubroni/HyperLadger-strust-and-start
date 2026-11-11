import {createContext, useState} from "react";
const AtlantContext = createContext({})

// Адрес API: тот же компьютер, с которого открыт сайт
const API = "http://" + window.location.hostname + ":8091"

// Запрос к API. token — токен сессии, который API выдаёт при входе
const request = async (token, method, path, body) => {
    let res;
    try {
        res = await fetch(API + path, {
            method: method,
            headers: { "Content-Type": "application/json", Authorization: token },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch {
        throw new Error("Нет связи с API");
    }
    const result = await res.json();
    if (!res.ok) {
        throw new Error(result.error);
    }
    return result;
}

const AppProvider = ({ children }) => {

    // Имя вошедшего пользователя и токен его сессии
    const [user, setUser] = useState("")
    const [token, setToken] = useState("")
    // Роли из контракта (WhoAmI): банк, сотрудник ДПС, зарегистрированный водитель
    const [roles, setRoles] = useState({ isBank: false, isDps: false, isDriver: false })
    const [isAuthorized, setIsAuthorized] = useState(false)

    // Имя пользователя в сети: латиница, цифры, _ и -
    const checkName = (name) => {
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            throw new Error("Имя: латинские буквы, цифры, _ и -, например ivanov");
        }
    };

    // После входа контракт (WhoAmI) сообщает роли пользователя
    const enter = async (name, newToken) => {
        const who = await request(newToken, "GET", "/contract/WhoAmI");
        if (!who.isBank && !who.isDps && !who.isDriver) {
            throw new Error("Пользователь не зарегистрирован как водитель");
        }
        setRoles(who);
        setToken(newToken);
        setUser(name);
        setIsAuthorized(true);
    };

    // Вход: API проверяет пароль через CA и выдаёт сертификат на время сессии
    const login = async (name, password) => {
        try {
            checkName(name.trim());
            const result = await request("", "POST", "/login", { name: name.trim(), password: password });
            await enter(name.trim(), result.token);
            alert("вы авторизовались");
        } catch (e) {
            alert(e.message);
        }
    };

    // Регистрация водителя: API создаёт пользователя в CA и запись водителя в контракте
    const register = async (name, password, fullName, experienceStartYear) => {
        try {
            checkName(name.trim());
            const result = await request("", "POST", "/register", {
                name: name.trim(),
                password: password,
                fullName: fullName,
                experienceStartYear: experienceStartYear,
            });
            await enter(name.trim(), result.token);
            alert("вы зарегистрировались");
        } catch (e) {
            alert(e.message);
        }
    };

    const logout = () => {
        setIsAuthorized(false)
        setUser("")
        setToken("")
        setRoles({ isBank: false, isDps: false, isDriver: false })
    }

    // Чтение из контракта: GET /contract/<метод>?args=...
    const get = async (method, args = []) => {
        const query = new URLSearchParams(args.map((arg) => ["args", arg]));
        return request(token, "GET", `/contract/${method}?${query}`);
    };

    // Запись в контракт: POST /contract/<метод>, транзакция попадает в блок
    const post = async (method, args = []) => {
        try {
            const result = await request(token, "POST", `/contract/${method}`, { args: args });
            console.log(result);
            if (result.message) {
                alert(result.message);
            } else {
                alert("успешно");
            }
        } catch (e) {
            alert(e.message);
        }
    };


    const values = {
        user,
        isAuthorized,
        isBank: roles.isBank,
        isDps: roles.isDps,
        isDriver: roles.isDriver,
        login,
        register,
        logout,
        get,
        post
    }

    return <AtlantContext.Provider value={values}>{children}</AtlantContext.Provider>
}
export {AppProvider, AtlantContext}
